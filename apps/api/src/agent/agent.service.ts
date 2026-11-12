import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  AgentIntentsDepositInput,
  AgentPolicy,
  AgentPolicyInput,
  AgentSwapInput,
  AgentSwapQuoteInput,
  DEFAULT_AGENT_POLICY,
  ProposeAgentPaymentInput,
  formatUnits,
  parseUnits,
  validatePayoutAddress,
} from '@keiz/shared';
import { InvoicesService } from '../invoices/invoices.service';
import { VendorsService } from '../vendors/vendors.service';
import { OutlayerService } from '../outlayer/outlayer.service';
import { QueueProducer } from '../queues/queue-producer.service';
import { PaymentIntentsService } from '../payments/payment-intents.service';
import { PaymentProviderFactory } from '../payments/payment-provider.factory';
import { PaymentsService } from '../payments/payments.service';
import { walletNetwork } from '../common/network';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { AgentAction, AgentActionDocument } from './agent-action.schema';
import { AgentDailySpend, AgentDailySpendDocument } from './agent-daily-spend.schema';
import { AgentWallet, AgentWalletDocument } from './agent-wallet.schema';
import { decryptSecret, deriveMasterKey, encryptSecret } from './agent-crypto';
import { evaluatePolicy } from './policy';

type Role = 'OWNER' | 'ADMIN' | 'APPROVER' | 'MEMBER';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @InjectModel(AgentWallet.name) private readonly wallets: Model<AgentWalletDocument>,
    @InjectModel(AgentAction.name) private readonly actions: Model<AgentActionDocument>,
    @InjectModel(AgentDailySpend.name)
    private readonly spend: Model<AgentDailySpendDocument>,
    @InjectModel(Payment.name) private readonly paymentsModel: Model<PaymentDocument>,
    private readonly invoices: InvoicesService,
    private readonly vendors: VendorsService,
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderFactory,
    private readonly outlayer: OutlayerService,
    private readonly config: ConfigService,
    private readonly queue: QueueProducer,
    private readonly intents: PaymentIntentsService,
  ) {}

  private masterKey(): Buffer {
    return deriveMasterKey(
      this.config.get<string>('AGENT_WALLET_MASTER_KEY') || undefined,
      this.config.get<string>('JWT_SECRET'),
    );
  }

  /**
   * The NEAR NEP-141 contract behind the Intents USDC balance. Resolve it from
   * the provider token list; never hardcode an asset id.
   */
  private async intentsUsdcToken() {
    try {
      const tokens = await this.providers.get().getTokens();
      const usdc = tokens.find(
        (token) =>
          token.blockchain.toLowerCase() === 'near' &&
          token.symbol.toUpperCase() === 'USDC',
      );
      if (!usdc) return null;
      return {
        symbol: 'USDC',
        assetId: usdc.assetId,
        tokenContract: usdc.contractAddress ?? usdc.assetId.replace(/^nep141:/, ''),
        decimals: usdc.decimals,
      };
    } catch (error) {
      this.logger.warn(`Could not resolve Intents USDC token: ${(error as Error).message}`);
      return null;
    }
  }

  private sanitize(wallet: AgentWalletDocument | (AgentWallet & { _id?: unknown })) {
    const obj = 'toObject' in wallet ? wallet.toObject() : { ...wallet };
    delete (obj as Record<string, unknown>).encryptedSecret;
    delete (obj as Record<string, unknown>).outlayerApiKeyEncrypted;
    return obj;
  }

  private decryptOutlayerKey(wallet: AgentWalletDocument): string {
    if (!wallet.outlayerApiKeyEncrypted) {
      throw new BadRequestException('Custody wallet has no API key');
    }
    return decryptSecret(wallet.outlayerApiKeyEncrypted, this.masterKey()).toString('utf8');
  }

  async getWallet(orgId: string, role: Role = 'MEMBER') {
    const wallet = await this.wallets
      .findOne({ orgId })
      .select('+outlayerApiKeyEncrypted');
    if (!wallet) return null;

    const base = this.sanitize(wallet);
    let custody: Awaited<ReturnType<OutlayerService['describe']>> | null = null;
    let handoffUrl: string | null = null;

    if (wallet.provider === 'outlayer' && wallet.outlayerApiKeyEncrypted) {
      const apiKey = this.decryptOutlayerKey(wallet);
      try {
        custody = await this.outlayer.describe(apiKey);
      } catch (error) {
        this.logger.warn(`Could not read custody wallet: ${(error as Error).message}`);
      }
      if (role === 'OWNER') {
        handoffUrl = wallet.outlayerHandoffUrl ?? this.outlayer.handoffUrl(apiKey);
      }
    }

    return {
      ...base,
      custody,
      handoffUrl,
      intentsUsdcToken: await this.intentsUsdcToken(),
    };
  }

  private async createLocalWallet(orgId: string) {
    const keyPair = nacl.sign.keyPair();
    const configured = this.config.get<string>('AGENT_ACCOUNT_ID');
    const network = walletNetwork(this.config);
    if (network === 'mainnet' && configured?.endsWith('.testnet')) {
      throw new BadRequestException(
        'AGENT_ACCOUNT_ID is a testnet account but the app network is mainnet.',
      );
    }
    const accountId = configured || `agent-${orgId.slice(-8)}`;
    const wallet = await this.wallets.create({
      orgId,
      accountId,
      publicKey: `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`,
      provider: 'local',
      encryptedSecret: encryptSecret(keyPair.secretKey, this.masterKey()),
      policy: DEFAULT_AGENT_POLICY,
      status: 'ACTIVE',
    });
    this.logger.log(`Created local agent wallet for org ${orgId} (${accountId})`);
    return wallet;
  }

  private async registerCustodyWallet(orgId: string) {
    const registration = await this.outlayer.register();
    const encryptedKey = encryptSecret(
      Buffer.from(registration.apiKey, 'utf8'),
      this.masterKey(),
    );
    const wallet = await this.wallets.create({
      orgId,
      accountId: registration.nearAccountId,
      publicKey: registration.publicKey,
      provider: 'outlayer',
      outlayerWalletId: registration.walletId,
      outlayerNetwork: this.outlayer.networkName,
      outlayerHandoffUrl: registration.handoffUrl,
      outlayerApiKeyEncrypted: encryptedKey,
      policy: DEFAULT_AGENT_POLICY,
      status: 'ACTIVE',
    });
    this.logger.log(
      `Created OutLayer custody wallet for org ${orgId} (${registration.nearAccountId})`,
    );
    return wallet;
  }

  async getOrCreateWallet(orgId: string) {
    const existing = await this.wallets.findOne({ orgId });
    if (existing) return this.getWallet(orgId, 'OWNER');

    const wallet = this.outlayer.isEnabled
      ? await this.registerCustodyWallet(orgId)
      : await this.createLocalWallet(orgId);
    return this.getWallet(orgId, 'OWNER').then((value) => value ?? this.sanitize(wallet));
  }

  /** Upgrade an existing local wallet to OutLayer custody, keeping its history. */
  async createCustodyWallet(orgId: string) {
    if (!this.outlayer.isEnabled) {
      throw new ServiceUnavailableException('OutLayer custody is disabled');
    }
    const existing = await this.wallets.findOne({ orgId });
    if (existing?.provider === 'outlayer') {
      return this.getWallet(orgId, 'OWNER');
    }

    const registration = await this.outlayer.register();
    const encryptedKey = encryptSecret(
      Buffer.from(registration.apiKey, 'utf8'),
      this.masterKey(),
    );

    if (!existing) {
      await this.wallets.create({
        orgId,
        accountId: registration.nearAccountId,
        publicKey: registration.publicKey,
        provider: 'outlayer',
        outlayerWalletId: registration.walletId,
        outlayerNetwork: this.outlayer.networkName,
        outlayerHandoffUrl: registration.handoffUrl,
        outlayerApiKeyEncrypted: encryptedKey,
        policy: DEFAULT_AGENT_POLICY,
        status: 'ACTIVE',
      });
    } else {
      await this.wallets.updateOne(
        { _id: existing._id },
        {
          $set: {
            provider: 'outlayer',
            accountId: registration.nearAccountId,
            publicKey: registration.publicKey,
            outlayerWalletId: registration.walletId,
            outlayerNetwork: this.outlayer.networkName,
            outlayerHandoffUrl: registration.handoffUrl,
            outlayerApiKeyEncrypted: encryptedKey,
          },
          $unset: { encryptedSecret: 1 },
        },
      );
    }
    return this.getWallet(orgId, 'OWNER');
  }

  async updatePolicy(orgId: string, input: AgentPolicyInput) {
    const wallet = await this.wallets.findOne({ orgId });
    if (!wallet) throw new NotFoundException('Create an agent wallet first');
    if (wallet.provider === 'outlayer') {
      throw new BadRequestException(
        'Custody policy is enforced inside OutLayer. Open the custody handoff to change it.',
      );
    }
    wallet.policy = input as AgentPolicy;
    wallet.status = input.active ? 'ACTIVE' : 'PAUSED';
    await wallet.save();
    return this.sanitize(wallet);
  }

  private async custodyForSwap(orgId: string) {
    const wallet = await this.wallets.findOne({ orgId }).select('+outlayerApiKeyEncrypted');
    if (!wallet) throw new NotFoundException('Create an agent wallet first');
    if (wallet.provider !== 'outlayer' || !wallet.outlayerApiKeyEncrypted) {
      throw new BadRequestException('OutLayer custody is not enabled for this wallet');
    }
    if (!this.outlayer.isEnabled) {
      throw new ServiceUnavailableException('OutLayer custody is disabled');
    }
    return { wallet, apiKey: this.decryptOutlayerKey(wallet) };
  }

  private async swapTokens(apiKey: string) {
    try {
      const [wnear, usdc] = await Promise.all([
        this.outlayer.resolveToken(apiKey, 'near', 'WNEAR'),
        this.outlayer.resolveToken(apiKey, 'near', 'USDC'),
      ]);
      if (wnear.decimals !== 24) {
        throw new Error(`Unexpected wNEAR decimals: ${wnear.decimals}`);
      }
      return { wnear, usdc };
    } catch (error) {
      throw new ServiceUnavailableException(
        `OutLayer does not list wNEAR/USDC on NEAR: ${(error as Error).message}`,
      );
    }
  }

  private amountToYocto(amountNear: string): bigint {
    let amount: bigint;
    try {
      amount = BigInt(parseUnits(amountNear, 24));
    } catch {
      throw new BadRequestException('Amount must be a valid NEAR decimal');
    }
    if (amount <= 0n) throw new BadRequestException('Amount must be positive');
    return amount;
  }

  /** Quote NEAR -> Intents USDC, including the gas reserve check. */
  async swapQuote(orgId: string, input: AgentSwapQuoteInput) {
    const { apiKey } = await this.custodyForSwap(orgId);
    const { wnear, usdc } = await this.swapTokens(apiKey);
    const amount = this.amountToYocto(input.amountNear);
    let nativeBalanceRaw: string;
    try {
      const balance = await this.outlayer.getBalance(apiKey, { chain: 'near' });
      nativeBalanceRaw = balance.balance ?? '0';
    } catch (error) {
      throw new ServiceUnavailableException(
        `Could not read the custody NEAR balance: ${(error as Error).message}`,
      );
    }
    const reserve = BigInt(parseUnits('0.1', 24));
    const nativeBalance = BigInt(nativeBalanceRaw);
    if (nativeBalance <= reserve || amount + reserve > nativeBalance) {
      throw new BadRequestException(
        `Amount exceeds the available NEAR balance (${formatUnits(
          (nativeBalance > reserve ? nativeBalance - reserve : 0n).toString(),
          24,
        )} NEAR after reserve)`,
      );
    }

    let quote;
    try {
      quote = await this.outlayer.swapQuote(apiKey, {
        token_in: wnear.tokenId,
        token_out: usdc.tokenId,
        amount_in: amount.toString(),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Could not quote the NEAR -> USDC swap: ${(error as Error).message}`,
      );
    }

    return {
      nativeBalance: nativeBalanceRaw,
      nativeBalanceFormatted: formatUnits(nativeBalanceRaw, 24),
      tokenIn: wnear,
      tokenOut: usdc,
      amountIn: amount.toString(),
      amountInFormatted: formatUnits(amount.toString(), 24),
      amountOut: quote.amount_out,
      amountOutFormatted: quote.amount_out
        ? formatUnits(quote.amount_out, usdc.decimals)
        : undefined,
      minAmountOut: quote.min_amount_out,
      minAmountOutFormatted: quote.min_amount_out
        ? formatUnits(quote.min_amount_out, usdc.decimals)
        : undefined,
      deadline: quote.deadline,
    };
  }

  /**
   * Wrap native NEAR to wNEAR when needed, then swap into the Intents USDC
   * balance. OutLayer enforces policy and may return pending_approval.
   */
  async swap(orgId: string, input: AgentSwapInput) {
    const quote = await this.swapQuote(orgId, { amountNear: input.amountNear });
    const { apiKey } = await this.custodyForSwap(orgId);
    const { wnear, usdc } = await this.swapTokens(apiKey);
    const amount = BigInt(quote.amountIn);

    const wnearContract = wnear.tokenId.startsWith('nep141:')
      ? wnear.tokenId.slice('nep141:'.length)
      : 'wrap.near';
    const balance = await this.outlayer.getBalance(apiKey, {
      chain: 'near',
      token: wnearContract,
    });
    const current = BigInt(balance.balance ?? '0');
    if (current < amount) {
      const wrapAmount = amount - current;
      let wrapped;
      try {
        wrapped = await this.outlayer.call(apiKey, {
          receiver_id: wnearContract,
          method_name: 'near_deposit',
          args: {},
          gas: '30000000000000',
          deposit: wrapAmount.toString(),
          idempotencyKey: `agent-swap-wrap-${orgId}-${Date.now()}`,
        });
      } catch (error) {
        throw new ServiceUnavailableException(
          `Could not wrap NEAR: ${(error as Error).message}`,
        );
      }
      if (wrapped.status !== 'success') {
        return {
          requestId: wrapped.request_id,
          status: wrapped.status,
          stage: 'wrap' as const,
          approvalId: wrapped.approval_id ?? undefined,
          required: wrapped.required ?? undefined,
          approved: wrapped.approved ?? undefined,
        };
      }
    }

    let swapped;
    try {
      swapped = await this.outlayer.swap(apiKey, {
        token_in: wnear.tokenId,
        token_out: usdc.tokenId,
        amount_in: amount.toString(),
        min_amount_out: input.minAmountOut ?? quote.minAmountOut,
        idempotencyKey: `agent-swap-${orgId}-${Date.now()}`,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Could not submit the swap: ${(error as Error).message}`,
      );
    }

    return {
      requestId: swapped.request_id,
      status: swapped.status,
      stage: 'swap' as const,
      amountOut: swapped.amount_out,
      intentHash: swapped.intent_hash,
    };
  }

  async swapStatus(orgId: string, requestId: string) {
    const { apiKey } = await this.custodyForSwap(orgId);
    const request = await this.outlayer.getRequest(apiKey, requestId);
    return {
      requestId: request.request_id,
      type: request.type,
      status: request.status,
      result: request.result,
      createdAt: request.created_at,
      updatedAt: request.updated_at,
    };
  }

  /**
   * Move on-chain USDC held by the custody account into intents.near, where
   * OutLayer withdrawals and swaps spend from.
   */
  async depositIntents(orgId: string, input: AgentIntentsDepositInput) {
    const { apiKey } = await this.custodyForSwap(orgId);
    let usdc;
    try {
      usdc = await this.outlayer.resolveToken(apiKey, 'near', 'USDC');
    } catch (error) {
      throw new ServiceUnavailableException(
        `OutLayer does not list USDC on NEAR: ${(error as Error).message}`,
      );
    }

    const balance = await this.outlayer.getBalance(apiKey, {
      chain: 'near',
      token: usdc.tokenId.replace(/^nep141:/, ''),
    });
    const available = BigInt(balance.balance ?? '0');
    let amount: bigint;
    try {
      amount = input.amountUsdc
        ? BigInt(parseUnits(input.amountUsdc, usdc.decimals))
        : available;
    } catch {
      throw new BadRequestException('Amount must be a valid USDC decimal');
    }
    if (amount <= 0n) {
      throw new BadRequestException('No on-chain USDC is available to move');
    }
    if (amount > available) {
      throw new BadRequestException(
        `Amount exceeds the on-chain USDC balance (${formatUnits(
          available.toString(),
          usdc.decimals,
        )} USDC)`,
      );
    }

    let response;
    try {
      response = await this.outlayer.intentsDeposit(apiKey, {
        token: usdc.tokenId,
        amount: amount.toString(),
        idempotencyKey: `agent-intents-deposit-${orgId}-${Date.now()}`,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Could not deposit USDC into Intents: ${(error as Error).message}`,
      );
    }

    return {
      requestId: response.request_id,
      status: response.status,
      txHash: response.tx_hash ?? undefined,
      amount: amount.toString(),
      amountFormatted: formatUnits(amount.toString(), usdc.decimals),
    };
  }

  private dayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async spentTodayCents(orgId: string): Promise<number> {
    const day = this.dayKey();
    const doc = await this.spend.findOne({ orgId, day }).lean();
    if (doc) return doc.spentCents;

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const rows = await this.actions
      .aggregate<{ total: number }>([
        { $match: { orgId, status: 'EXECUTED', executedAt: { $gte: start } } },
        {
          $group: {
            _id: null,
            total: {
              $sum: { $round: [{ $multiply: [{ $toDouble: '$amountUsd' }, 100] }, 0] },
            },
          },
        },
      ])
      .exec();
    return rows[0]?.total ?? 0;
  }

  async spentTodayUsd(orgId: string): Promise<string> {
    const cents = await this.spentTodayCents(orgId);
    return (cents / 100).toFixed(2);
  }

  /**
   * Preview a spend without reserving it. Used by agent jobs before a human
   * confirms the hire, and re-checked again at execution time.
   */
  async previewSpend(orgId: string, amountUsd: string, asset: string) {
    const wallet = await this.wallets.findOne({ orgId });
    if (!wallet) throw new NotFoundException('Create an agent wallet first');
    const spentTodayUsd = await this.spentTodayUsd(orgId);
    if (wallet.provider === 'outlayer') {
      return {
        allowed: true,
        requiresApproval: false,
        reason: 'Delegated to the OutLayer custody policy',
        delegated: true,
        spentTodayUsd,
        reservedCents: 0,
        policyDecision: { decision: 'delegated', provider: 'outlayer' },
      };
    }
    const decision = evaluatePolicy({
      policy: wallet.policy,
      amountUsd,
      asset,
      spentTodayUsd,
    });
    return {
      ...decision,
      delegated: false,
      spentTodayUsd,
      reservedCents: 0,
      policyDecision: { ...decision },
    };
  }

  /** Atomically reserve the local daily budget. OutLayer delegates at signing time. */
  async authorizeSpend(orgId: string, amountUsd: string, asset: string) {
    const preview = await this.previewSpend(orgId, amountUsd, asset);
    if (!preview.allowed || preview.delegated) return preview;
    const wallet = await this.wallets.findOne({ orgId });
    if (!wallet) throw new NotFoundException('Create an agent wallet first');
    const cents = Number(parseUnits(amountUsd, 2));
    const limitCents = Number(parseUnits(wallet.policy.dailyLimitUsd, 2));
    if (!(await this.reserveDaily(orgId, cents, limitCents))) {
      return {
        ...preview,
        allowed: false,
        reason: 'Daily limit exceeded',
        reservedCents: 0,
        policyDecision: { ...preview.policyDecision, allowed: false, reason: 'Daily limit exceeded' },
      };
    }
    return { ...preview, reservedCents: cents };
  }

  async releaseSpend(orgId: string, reservedCents: number) {
    if (reservedCents > 0) await this.releaseDaily(orgId, reservedCents);
  }

  private async reserveDaily(orgId: string, cents: number, limitCents: number): Promise<boolean> {
    const day = this.dayKey();
    const seeded = await this.spentTodayCents(orgId);
    try {
      await this.spend.updateOne(
        { orgId, day },
        { $setOnInsert: { spentCents: seeded } },
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const updated = await this.spend.findOneAndUpdate(
      { orgId, day, spentCents: { $lte: Math.max(0, limitCents - cents) } },
      { $inc: { spentCents: cents } },
      { returnDocument: 'after' },
    );
    return Boolean(updated);
  }

  private async releaseDaily(orgId: string, cents: number) {
    const day = this.dayKey();
    await this.spend.updateOne(
      { orgId, day, spentCents: { $gte: cents } },
      { $inc: { spentCents: -cents } },
    );
  }

  async listActions(orgId: string) {
    return this.actions.find({ orgId }).sort({ createdAt: -1 }).limit(50).lean();
  }

  private async assertNoLivePayment(
    orgId: string,
    invoiceId: string,
    options?: { excludeActionId?: string },
  ) {
    const live = await this.paymentsModel.findOne({
      orgId,
      invoiceId,
      status: { $in: ['AWAITING_DEPOSIT', 'PROCESSING'] },
    });
    if (live) {
      if (options?.excludeActionId && String(live.agentActionId ?? '') === options.excludeActionId) {
        return;
      }
      throw new ConflictException(
        `An open payment (${String(live._id)}) already exists for this invoice. ` +
          'Wait for it to settle, expire or be cancelled before trying again.',
      );
    }
    const openIntent = await this.intents.findOpenIntent(orgId, invoiceId);
    if (openIntent) {
      if (options?.excludeActionId) {
        const ownAction = await this.actions.findOne({ _id: options.excludeActionId });
        if (ownAction?.paymentIntentId === String(openIntent._id)) return;
      }
      throw new ConflictException(
        'This invoice already has an open payment intent on another rail',
      );
    }
  }

  async propose(orgId: string, input: ProposeAgentPaymentInput) {
    const wallet = await this.wallets.findOne({ orgId });
    if (!wallet) throw new NotFoundException('Create an agent wallet first');
    const invoice = await this.invoices.findOne(orgId, input.invoiceId);
    if (!['APPROVED', 'PAYMENT_PENDING'].includes(invoice.status)) {
      throw new BadRequestException('Only approved invoices can be proposed for agent payment');
    }
    // Never propose against an invoice that already has money in flight: the
    // custody branch would otherwise create a second payment for the same bill.
    await this.assertNoLivePayment(orgId, String(invoice._id));

    const amountUsd = formatUnits(invoice.total, invoice.decimals);

    // Custody wallets are governed by the OutLayer policy (TEE + on-chain).
    // The local USD caps would otherwise block legitimate custody payments.
    if (wallet.provider === 'outlayer') {
      const intent = await this.intents.reserve({
        orgId,
        invoiceId: String(invoice._id),
        amount: invoice.total,
        currency: invoice.currency,
        rail: 'outlayer',
      });
      let action;
      try {
        action = await this.actions.create({
          orgId,
          walletId: wallet.id,
          invoiceId: String(invoice._id),
          type: 'PAYMENT',
          asset: input.asset,
          amountUsd,
          status: 'APPROVED',
          reason: input.reason ?? 'OutLayer policy is enforced at execution',
          policyDecision: { decision: 'delegated', provider: 'outlayer' },
          paymentIntentId: String(intent._id),
        });
      } catch (error) {
        await this.intents.cancel(String(intent._id));
        throw error;
      }
      return action.toObject();
    }

    const spent = await this.spentTodayUsd(orgId);
    const decision = evaluatePolicy({
      policy: wallet.policy,
      amountUsd,
      asset: input.asset,
      spentTodayUsd: spent,
    });

    const status = !decision.allowed
      ? 'BLOCKED'
      : decision.requiresApproval
        ? 'PENDING_APPROVAL'
        : 'APPROVED';

    const action = await this.actions.create({
      orgId,
      walletId: wallet.id,
      invoiceId: String(invoice._id),
      type: 'PAYMENT',
      asset: input.asset,
      amountUsd,
      status,
      reason: input.reason ?? decision.reason,
      policyDecision: { ...decision },
    });
    return action.toObject();
  }

  async decide(orgId: string, userId: string, id: string, decision: 'APPROVE' | 'REJECT') {
    const action = await this.actions.findOne({ _id: id, orgId });
    if (!action) throw new NotFoundException('Agent action not found');
    if (action.outlayerApprovalId) {
      throw new BadRequestException(
        'This action needs an OutLayer custody approval. Open the custody approvals page.',
      );
    }
    if (action.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Action is ${action.status}, not pending approval`);
    }
    action.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    action.decidedByUserId = userId;
    await action.save();
    if (decision === 'REJECT' && action.paymentIntentId) {
      await this.intents.cancel(action.paymentIntentId);
    }
    return action.toObject();
  }

  async execute(orgId: string, userId: string, accountId: string, id: string) {
    const action = await this.actions.findOneAndUpdate(
      { _id: id, orgId, status: 'APPROVED' },
      { $set: { status: 'EXECUTING' } },
      { returnDocument: 'after' },
    );
    if (!action) {
      const existing = await this.actions.findOne({ _id: id, orgId });
      if (!existing) throw new NotFoundException('Agent action not found');
      throw new ConflictException(`Action is ${existing.status}, not approved`);
    }

    let reservedCents = 0;
    try {
      const wallet = await this.wallets
        .findOne({ orgId })
        .select('+outlayerApiKeyEncrypted');
      if (!wallet) throw new NotFoundException('Agent wallet missing');

      if (wallet.provider !== 'outlayer') {
        const spent = await this.spentTodayUsd(orgId);
        const decision = evaluatePolicy({
          policy: wallet.policy,
          amountUsd: action.amountUsd,
          asset: action.asset,
          spentTodayUsd: spent,
        });
        if (!decision.allowed) {
          action.status = 'BLOCKED';
          action.policyDecision = { ...decision };
          await action.save();
          throw new BadRequestException(`Blocked by policy: ${decision.reason}`);
        }

        const cents = Number(parseUnits(action.amountUsd, 2));
        const limitCents = Number(parseUnits(wallet.policy.dailyLimitUsd, 2));
        if (!(await this.reserveDaily(orgId, cents, limitCents))) {
          action.status = 'BLOCKED';
          action.policyDecision = { ...decision, reason: 'Daily limit exceeded' };
          await action.save();
          throw new BadRequestException('Blocked by policy: daily limit exceeded');
        }
        reservedCents = cents;
      }

      const invoice = await this.invoices.findOne(orgId, action.invoiceId);
      if (!['APPROVED', 'PAYMENT_PENDING'].includes(invoice.status)) {
        throw new BadRequestException(`Invoice is ${invoice.status}; cannot execute`);
      }
      // A different live quote means this action would double-pay the invoice.
      await this.assertNoLivePayment(orgId, String(invoice._id), {
        excludeActionId: String(action._id),
      });
      if (invoice.status === 'PAYMENT_PENDING') {
        await this.invoices.resetForRetry(orgId, String(invoice._id));
      }

      if (wallet.provider === 'outlayer' && !action.paymentIntentId) {
        const intent = await this.intents.reserve({
          orgId,
          invoiceId: String(invoice._id),
          amount: invoice.total,
          currency: invoice.currency,
          rail: 'outlayer',
          createdByUserId: userId,
        });
        action.paymentIntentId = String(intent._id);
        await action.save();
      }

      const result =
        wallet.provider === 'outlayer'
          ? await this.executeWithCustody(orgId, userId, action, wallet, invoice)
          : await this.executeWithPaymentProvider(orgId, userId, accountId, action, invoice);

      return result;
    } catch (error) {
      if (reservedCents > 0) await this.releaseDaily(orgId, reservedCents);
      if (action.status === 'EXECUTING') {
        // If an external side effect may already have happened, never put the
        // action back in a state that invites a retry. Send it to review.
        action.status =
          action.outlayerRequestId || action.paymentId ? 'NEEDS_REVIEW' : 'APPROVED';
        await action.save();
      }
      if (action.paymentIntentId && !action.paymentId) {
        if (action.outlayerRequestId) {
          await this.intents.setStatus(action.paymentIntentId, 'EXECUTING');
        } else {
          await this.intents.cancel(action.paymentIntentId);
        }
      }
      throw error;
    }
  }

  private async executeWithPaymentProvider(
    orgId: string,
    userId: string,
    accountId: string,
    action: AgentActionDocument,
    invoice: { _id: unknown },
  ) {
    const result = await this.payments.create(orgId, userId, accountId, {
      invoiceId: String(invoice._id),
      originAsset: '',
      destinationAsset: action.asset,
      slippageBps: 100,
      payer: 'AGENT',
      idempotencyKey: `agent-action-${String(action._id)}`,
    });

    action.status = 'EXECUTED';
    action.paymentId = result.payment._id?.toString();
    action.executedAt = new Date();
    await action.save();

    return { action: action.toObject(), payment: result.payment };
  }

  private async executeWithCustody(
    orgId: string,
    userId: string,
    action: AgentActionDocument,
    wallet: AgentWalletDocument,
    invoice: {
      _id: unknown;
      total: string;
      decimals: number;
      currency: string;
      vendorId: string;
      status: string;
    },
  ) {
    if (invoice.currency !== 'USD') {
      throw new BadRequestException(
        `Custody payouts support USD invoices only (received ${invoice.currency})`,
      );
    }
    const apiKey = this.decryptOutlayerKey(wallet);
    const vendorRecord = await this.vendors.findOne(orgId, invoice.vendorId);
    const addressError = validatePayoutAddress(
      vendorRecord.payoutChain,
      vendorRecord.payoutAddress,
    );
    if (addressError) {
      throw new BadRequestException(`Vendor payout address is invalid: ${addressError}`);
    }
    if (
      this.outlayer.networkName === 'testnet' &&
      vendorRecord.payoutChain.toLowerCase() !== 'near'
    ) {
      // OutLayer testnet has no Intents solvers. Do not let the action retry
      // forever against an endpoint that will only return 503.
      action.status = 'BLOCKED';
      action.reason =
        'Cross-chain custody payouts are mainnet-only. Switch OutLayer to mainnet or pay this vendor on NEAR.';
      await action.save();
      throw new ServiceUnavailableException(
        'OutLayer testnet cannot pay across chains. Use a NEAR vendor or mainnet custody.',
      );
    }

    const usd = formatUnits(invoice.total, invoice.decimals);
    let token;
    try {
      token = await this.outlayer.resolveToken(apiKey, vendorRecord.payoutChain, 'USDC');
    } catch {
      token = await this.outlayer.resolveToken(apiKey, vendorRecord.payoutChain, 'USDT');
    }
    const amount = parseUnits(usd, token.decimals).toString();

    const dryRun = await this.outlayer.withdrawDryRun(apiKey, {
      chain: vendorRecord.payoutChain,
      to: vendorRecord.payoutAddress,
      amount,
      token: token.tokenId,
    });
    if (dryRun.would_succeed === false) {
      throw new BadRequestException(
        `Custody policy refused the payment: ${dryRun.reason ?? 'unknown'} ${dryRun.message ?? ''}`.trim(),
      );
    }
    const policyDecision = dryRun.policy_check?.decision;
    if (!policyDecision || !['allowed', 'requires_approval'].includes(policyDecision)) {
      throw new BadRequestException(
        `Custody wallet has no usable policy (${policyDecision ?? 'unknown'}). Set a policy in the OutLayer handoff before paying.`,
      );
    }

    const response = await this.outlayer.withdraw(apiKey, {
      chain: vendorRecord.payoutChain,
      to: vendorRecord.payoutAddress,
      amount,
      token: token.tokenId,
      idempotencyKey: `agent-action-${String(action._id)}`,
    });

    const pendingApproval = response.status === 'pending_approval';
    const paymentStatus =
      response.status === 'success'
        ? 'SUCCEEDED'
        : response.status === 'failed'
          ? 'FAILED'
          : response.status === 'refunded'
            ? 'REFUNDED'
            : 'PROCESSING';
    const actionStatus = pendingApproval
      ? 'PENDING_APPROVAL'
      : paymentStatus === 'FAILED' || paymentStatus === 'REFUNDED'
        ? 'FAILED'
        : 'EXECUTING';

    // Persist the external request id before creating the payment. If the DB
    // write below fails, the catch block must never put the action back into
    // APPROVED and invite a second withdrawal.
    action.outlayerRequestId = response.request_id;
    action.outlayerApprovalId = response.approval_id ?? undefined;
    action.outlayerRequired = response.required ?? undefined;
    action.outlayerApproved = response.approved ?? undefined;
    action.status = actionStatus;
    action.executedAt = undefined;
    await action.save();

    if (paymentStatus === 'FAILED' || paymentStatus === 'REFUNDED') {
      if (action.paymentIntentId) await this.intents.cancel(action.paymentIntentId);
      throw new BadRequestException(`Custody withdrawal ended as ${response.status}`);
    }

    const payment = await this.paymentsModel.create({
      orgId,
      invoiceId: String(invoice._id),
      provider: 'outlayer',
      payer: 'AGENT',
      status: paymentStatus,
      rawStatus: response.status,
      originAsset: token.tokenId,
      destinationAsset: token.tokenId,
      originSymbol: token.symbol,
      destinationSymbol: token.symbol,
      destinationChain: vendorRecord.payoutChain,
      destinationAddress: vendorRecord.payoutAddress,
      swapType: 'EXACT_OUTPUT',
      amountIn: amount,
      amountOut: amount,
      amountInFormatted: usd,
      amountOutFormatted: usd,
      correlationId: response.request_id,
      outlayerRequestId: response.request_id,
      createdByUserId: userId,
      payerAccountId: wallet.accountId,
      agentActionId: String(action._id),
    });

    action.paymentId = payment.id;
    if (paymentStatus === 'SUCCEEDED') {
      action.status = 'EXECUTED';
      action.executedAt = new Date();
    }
    await action.save();
    if (action.paymentIntentId) {
      await this.intents.attachPayment(action.paymentIntentId, payment.id, response.request_id);
      if (paymentStatus === 'SUCCEEDED') {
        await this.intents.setStatusForPayment(payment.id, 'SETTLED', response.status);
      }
    }

    await this.invoices.markPaymentPending(orgId, String(invoice._id), payment.id);
    if (paymentStatus === 'SUCCEEDED') {
      await this.invoices.markPaid(orgId, String(invoice._id));
    } else {
      await this.queue.enqueueOutlayerPoll(payment.id, 2_000);
    }

    return { action: action.toObject(), payment: payment.toObject() };
  }

  async stats(orgId: string) {
    const [spentTodayUsd, wallet, pending] = await Promise.all([
      this.spentTodayUsd(orgId),
      this.wallets.findOne({ orgId }).select('+outlayerApiKeyEncrypted'),
      this.actions.countDocuments({ orgId, status: 'PENDING_APPROVAL' }),
    ]);

    let custody: Awaited<ReturnType<OutlayerService['describe']>> | null = null;
    if (wallet?.provider === 'outlayer' && wallet.outlayerApiKeyEncrypted) {
      try {
        custody = await this.outlayer.describe(this.decryptOutlayerKey(wallet));
      } catch {
        custody = null;
      }
    }

    return {
      spentTodayUsd,
      pendingApprovals: pending,
      policy: wallet?.policy ?? DEFAULT_AGENT_POLICY,
      accountId: wallet?.accountId ?? null,
      active: wallet?.status === 'ACTIVE',
      provider: wallet?.provider ?? null,
      custodyAvailable: this.outlayer.isEnabled,
      custody,
      intentsUsdcToken: await this.intentsUsdcToken(),
      network: this.outlayer.networkName,
    };
  }
}
