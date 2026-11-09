import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CreatePaymentInput,
  PaymentListQuery,
  TERMINAL_PAYMENT_STATUSES,
  USD_STABLE_SYMBOLS,
  formatUnits,
  parseUnits,
  validatePayoutAddress,
} from '@keiz/shared';
import { dateRange } from '../common/date-range';
import { InvoicesService } from '../invoices/invoices.service';
import { VendorsService } from '../vendors/vendors.service';
import { PaymentEvent, PaymentEventDocument } from './payment-event.schema';
import { Payment, PaymentDocument } from './payment.schema';
import { NearTxVerifier } from './near-tx-verifier';
import { PaymentProviderFactory } from './payment-provider.factory';
import { PaymentProvider, QuoteResult, StatusResult, TokenInfo } from './providers/provider';
import { QueueProducer } from '../queues/queue-producer.service';
import { PaymentIntentsService } from './payment-intents.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(PaymentEvent.name) private readonly events: Model<PaymentEventDocument>,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly invoices: InvoicesService,
    private readonly vendors: VendorsService,
    private readonly nearTx: NearTxVerifier,
    private readonly queue: QueueProducer,
    private readonly intents: PaymentIntentsService,
  ) {}

  private get provider(): PaymentProvider {
    return this.providerFactory.get();
  }

  list(orgId: string, query: PaymentListQuery) {
    const filter: Record<string, unknown> = { orgId };
    if (query.invoiceId) filter.invoiceId = query.invoiceId;
    const range = dateRange(query, 'createdAt');
    if (range) Object.assign(filter, range);
    return this.payments.find(filter).sort({ createdAt: -1 }).lean();
  }

  listOpen(orgId: string) {
    return this.payments
      .find({ orgId, status: { $in: ['AWAITING_DEPOSIT', 'PROCESSING'] } })
      .sort({ createdAt: -1 })
      .lean();
  }

  async findOne(orgId: string, id: string) {
    const payment = await this.payments.findOne({ _id: id, orgId }).lean();
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  eventsFor(orgId: string, paymentId: string) {
    return this.events.find({ orgId, paymentId }).sort({ createdAt: 1, _id: 1 }).lean();
  }

  tokens(): Promise<TokenInfo[]> {
    return this.provider.getTokens();
  }

  async create(orgId: string, userId: string, accountId: string, input: CreatePaymentInput) {
    if (input.idempotencyKey) {
      const existing = await this.payments.findOne({ orgId, idempotencyKey: input.idempotencyKey });
      if (existing) {
        const tokens = await this.provider.getTokens();
        return {
          payment: existing.toObject(),
          originToken: this.resolveOrigin(tokens, existing.originAsset),
          destinationToken: this.resolveDestination(tokens, existing.destinationAsset),
          preview: null,
          idempotent: true,
        };
      }
    }

    const invoice = await this.invoices.findOne(orgId, input.invoiceId);

    const open = await this.payments.findOne({
      orgId,
      invoiceId: String(invoice._id),
      status: { $in: ['AWAITING_DEPOSIT', 'PROCESSING'] },
    });
    if (open) {
      throw new ConflictException(
        `An open payment already exists for this invoice (${open.id}). Wait for it to expire or cancel it.`,
      );
    }

    // Only APPROVED: a PAYMENT_PENDING invoice already has a live quote.
    if (invoice.status !== 'APPROVED') {
      throw new BadRequestException(
        `Invoice must be APPROVED before a new quote (currently ${invoice.status})`,
      );
    }
    if (invoice.currency !== 'USD') {
      throw new BadRequestException(
        'Only USD invoices are payable on-chain in this build (no FX oracle yet)',
      );
    }
    if (BigInt(invoice.total) <= 0n) {
      throw new BadRequestException('Invoice total must be positive');
    }

    const vendor = await this.vendors.findOne(orgId, invoice.vendorId);
    const addressError = validatePayoutAddress(vendor.payoutChain, vendor.payoutAddress);
    if (addressError) {
      throw new BadRequestException(`Vendor payout address is invalid: ${addressError}`);
    }

    const tokens = await this.provider.getTokens();
    const origin = this.resolveOrigin(tokens, input.originAsset);
    const destination = input.destinationAsset
      ? this.resolveDestinationById(tokens, input.destinationAsset, vendor.payoutChain)
      : this.resolveDestination(tokens, vendor.payoutChain);
    if (!(USD_STABLE_SYMBOLS as readonly string[]).includes(destination.symbol.toUpperCase())) {
      throw new BadRequestException('Destination must be a USD-pegged stablecoin');
    }

    const usd = formatUnits(invoice.total, invoice.decimals);
    const amount = parseUnits(usd, destination.decimals).toString();

    const quoteParams = {
      originAsset: origin.assetId,
      destinationAsset: destination.assetId,
      amount,
      swapType: 'EXACT_OUTPUT' as const,
      recipient: vendor.payoutAddress,
      refundTo: accountId,
      slippageBps: input.slippageBps,
    };

    // dry run first: cheap preview, catches bad routes before we commit a deposit address
    const preview: QuoteResult = await this.provider.quote({ ...quoteParams, dry: true });
    const committed: QuoteResult = await this.provider.quote({ ...quoteParams, dry: false });
    if (!committed.depositAddress) {
      throw new BadGatewayException('Payment provider did not return a deposit address');
    }
    if (BigInt(committed.amountOut) < BigInt(amount)) {
      throw new BadGatewayException('Quote would underpay the invoice; try again');
    }

    const intent = await this.intents.reserve({
      orgId,
      invoiceId: String(invoice._id),
      amount: invoice.total,
      currency: invoice.currency,
      rail: 'oneclick',
      createdByUserId: userId,
    });

    try {
      const payment = await this.payments.create({
        orgId,
        invoiceId: String(invoice._id),
        provider: this.provider.mode,
        payer: input.payer,
        status: 'AWAITING_DEPOSIT',
        originAsset: origin.assetId,
        destinationAsset: destination.assetId,
        originContract: origin.assetId.replace(/^nep141:/, ''),
        swapType: 'EXACT_OUTPUT',
        // Store the committed quote, not the preview: this is what the deposit address expects.
        amountIn: committed.amountIn,
        amountOut: committed.amountOut,
        amountInFormatted: committed.amountInFormatted,
        amountOutFormatted: committed.amountOutFormatted,
        minAmountIn: committed.minAmountIn,
        maxAmountIn: committed.maxAmountIn,
        minAmountOut: committed.minAmountOut,
        originSymbol: origin.symbol,
        destinationSymbol: destination.symbol,
        destinationChain: destination.blockchain,
        destinationAddress: vendor.payoutAddress,
        correlationId: committed.correlationId,
        depositAddress: committed.depositAddress,
        depositMemo: committed.depositMemo,
        deadline: committed.deadline ? new Date(committed.deadline) : undefined,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: userId,
        payerAccountId: accountId,
      });

      await this.events.create({
        orgId,
        paymentId: payment.id,
        status: 'QUOTED',
        payload: { committed: committed.raw },
      });
      await this.events.create({
        orgId,
        paymentId: payment.id,
        status: 'AWAITING_DEPOSIT',
        payload: { depositAddress: committed.depositAddress },
      });
      await this.invoices.markPaymentPending(orgId, String(invoice._id), payment.id);
      await this.intents.attachPayment(String(intent._id), payment.id, committed.correlationId);
      await this.queue.enqueuePaymentPoll(payment.id, 4_000);

      return {
        payment: payment.toObject(),
        originToken: origin,
        destinationToken: destination,
        preview,
      };
    } catch (error) {
      await this.intents.cancel(String(intent._id));
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('An open payment already exists for this invoice');
      }
      throw error;
    }
  }

  async confirmDeposit(orgId: string, id: string, accountId: string, txHash: string) {
    const payment = await this.payments.findOne({ _id: id, orgId });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!payment.depositAddress) throw new BadRequestException('Payment has no deposit address');
    if (TERMINAL_PAYMENT_STATUSES.includes(payment.status)) {
      return payment.toObject();
    }
    if (payment.txHash === txHash && payment.status === 'PROCESSING') {
      return payment.toObject(); // idempotent retry
    }

    const replay = await this.payments.exists({
      orgId,
      txHash,
      _id: { $ne: payment._id },
    });
    if (replay) {
      throw new ConflictException('This transaction hash is already attached to another payment');
    }

    // Never trust a client-supplied hash: verify the transfer on NEAR first.
    if (payment.provider === 'intents') {
      const verification = await this.nearTx.verify({
        txHash,
        senderAccountId: accountId,
        depositAddress: payment.depositAddress,
        originAsset: payment.originAsset,
        minAmount: payment.minAmountIn ?? payment.amountIn,
      });
      if (!verification.ok) {
        throw new BadRequestException(verification.reason ?? 'Deposit could not be verified');
      }
    }

    await this.provider.submitDeposit({
      depositAddress: payment.depositAddress,
      txHash,
      nearSenderAccount: accountId,
    });
    payment.txHash = txHash;
    payment.submittedAt = new Date();
    payment.status = 'PROCESSING';
    await payment.save();
    await this.queue.enqueuePaymentPoll(payment.id, 4_000);

    await this.events.create({
      orgId,
      paymentId: payment.id,
      status: 'PROCESSING',
      payload: { depositTxHash: txHash, verified: payment.provider === 'intents' },
    });
    return payment.toObject();
  }

  async cancel(orgId: string, id: string) {
    const payment = await this.payments.findOne({ _id: id, orgId });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'AWAITING_DEPOSIT') {
      throw new BadRequestException(`Only an awaiting-deposit quote can be cancelled (${payment.status})`);
    }
    await this.applyStatus(payment, {
      status: 'EXPIRED',
      rawStatus: 'CANCELLED',
      raw: {},
    });
    return payment.toObject();
  }

  async refresh(orgId: string, id: string) {
    const payment = await this.payments.findOne({ _id: id, orgId });
    if (!payment) throw new NotFoundException('Payment not found');
    if (TERMINAL_PAYMENT_STATUSES.includes(payment.status)) return payment.toObject();
    await this.applyStatus(payment, await this.provider.getStatus(payment.depositAddress!, payment.depositMemo));
    return payment.toObject();
  }

  /** Called by the queue worker for one payment. */
  async pollOne(
    paymentId: string,
  ): Promise<'pending' | 'terminal' | 'missing'> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) return 'missing';
    if (TERMINAL_PAYMENT_STATUSES.includes(payment.status)) return 'terminal';
    if (!payment.depositAddress) return 'terminal';
    if (
      payment.status === 'AWAITING_DEPOSIT' &&
      payment.deadline &&
      payment.deadline.getTime() < Date.now()
    ) {
      await this.applyStatus(payment, {
        status: 'EXPIRED',
        rawStatus: 'QUOTE_EXPIRED',
        raw: {},
      });
      return 'terminal';
    }
    const result = await this.provider.getStatus(payment.depositAddress, payment.depositMemo);
    if (result.status !== payment.status) {
      await this.applyStatus(payment, result);
    }
    return TERMINAL_PAYMENT_STATUSES.includes(payment.status) ? 'terminal' : 'pending';
  }

  /** Called by the poller. Returns the number of payments that changed state. */
  async pollOpen(): Promise<number> {
    const open = await this.payments
      .find({ status: { $in: ['AWAITING_DEPOSIT', 'PROCESSING'] } })
      .limit(50);

    let changed = 0;
    for (const payment of open) {
      try {
        if (!payment.depositAddress) continue;
        if (
          payment.status === 'AWAITING_DEPOSIT' &&
          payment.deadline &&
          payment.deadline.getTime() < Date.now()
        ) {
          await this.applyStatus(payment, {
            status: 'EXPIRED',
            rawStatus: 'QUOTE_EXPIRED',
            raw: {},
          });
          changed += 1;
          continue;
        }
        const result = await this.provider.getStatus(payment.depositAddress, payment.depositMemo);
        if (result.status !== payment.status) {
          await this.applyStatus(payment, result);
          changed += 1;
        }
      } catch (error) {
        this.logger.warn(`Status poll failed for ${payment.id}: ${(error as Error).message}`);
      }
    }
    return changed;
  }

  private async applyStatus(payment: PaymentDocument, result: StatusResult) {
    const before = payment.status;
    const destinationTxHashes = result.swapDetails?.destinationTxHashes ?? [];
    // Do not release the invoice on 1Click SUCCESS alone: a missing destination
    // transaction is an unverified payout, not a settled one.
    const status =
      result.status === 'SUCCEEDED' &&
      destinationTxHashes.length === 0 &&
      payment.provider !== 'mock'
        ? 'NEEDS_REVIEW'
        : result.status;
    const rawStatus =
      status === 'NEEDS_REVIEW' && result.status === 'SUCCEEDED'
        ? 'DESTINATION_UNVERIFIED'
        : result.rawStatus;
    const set: Record<string, unknown> = { status, rawStatus };
    if (destinationTxHashes.length > 0) {
      set.destinationTxHashes = destinationTxHashes.map((tx) => ({
        hash: tx.hash,
        explorerUrl: tx.explorerUrl,
      }));
    }
    if (result.swapDetails?.originTxHashes) {
      set.originTxHashes = result.swapDetails.originTxHashes.map((tx) => ({
        hash: tx.hash,
        explorerUrl: tx.explorerUrl,
      }));
    }
    if (result.swapDetails?.refundReason) set.refundReason = result.swapDetails.refundReason;

    // Claim the transition atomically. A second worker polling the same payment
    // must not write a duplicate event or advance the invoice twice.
    const updated = await this.payments.findOneAndUpdate(
      { _id: payment._id, status: before },
      { $set: set },
      { returnDocument: 'after' },
    );
    if (!updated) return;
    Object.assign(payment, updated.toObject());

    await this.events.create({
      orgId: payment.orgId,
      paymentId: payment.id,
      status,
      rawStatus,
      payload: { from: before, raw: result.raw },
    });

    if (status === 'SUCCEEDED') {
      await this.intents.setStatusForPayment(payment.id, 'SETTLED', rawStatus);
      await this.invoices.markPaid(payment.orgId, payment.invoiceId);
    } else if (['FAILED', 'REFUNDED', 'UNDERPAID', 'EXPIRED'].includes(status)) {
      await this.intents.setStatusForPayment(payment.id, 'FAILED', rawStatus);
      await this.invoices.resetForRetry(payment.orgId, payment.invoiceId);
    }
  }

  simulate(orgId: string, id: string, status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED') {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException('Not available');
    }
    const mock = this.providerFactory.mock();
    return this.payments
      .findOne({ _id: id, orgId })
      .then((payment) => {
        if (!payment?.depositAddress) throw new NotFoundException('Payment not found');
        mock.forceStatus(payment.depositAddress, status);
        return { ok: true, status };
      });
  }

  private resolveOrigin(tokens: TokenInfo[], assetId?: string): TokenInfo {
    if (assetId) {
      const match = tokens.find((token) => token.assetId === assetId);
      if (!match || match.blockchain !== 'near') {
        throw new BadRequestException('originAsset must be a NEAR asset');
      }
      if (!['USDC', 'WNEAR', 'USDT'].includes(match.symbol.toUpperCase())) {
        throw new BadRequestException('originAsset must be USDC, USDT or wNEAR');
      }
      return match;
    }
    const match = tokens.find(
      (token) => token.blockchain === 'near' && token.symbol.toUpperCase() === 'USDC',
    );
    if (!match) throw new BadRequestException('USDC on NEAR is unavailable');
    return match;
  }

  private resolveDestinationById(
    tokens: TokenInfo[],
    assetId: string,
    chain: string,
  ): TokenInfo {
    const match = tokens.find((token) => token.assetId === assetId);
    if (!match) throw new BadRequestException(`Unsupported assetId: ${assetId}`);
    if (match.blockchain !== chain.toLowerCase()) {
      throw new BadRequestException(
        `destinationAsset is on ${match.blockchain}, but the vendor is paid on ${chain}`,
      );
    }
    if (!(USD_STABLE_SYMBOLS as readonly string[]).includes(match.symbol.toUpperCase())) {
      throw new BadRequestException('Destination must be a USD-pegged stablecoin');
    }
    return match;
  }

  private resolveDestination(tokens: TokenInfo[], chain: string): TokenInfo {
    const normalized = (chain || 'near').toLowerCase();
    for (const symbol of USD_STABLE_SYMBOLS) {
      const match = tokens.find(
        (token) => token.blockchain === normalized && token.symbol.toUpperCase() === symbol,
      );
      if (match) return match;
    }
    throw new BadRequestException(`No USD stablecoin available on ${normalized}`);
  }
}
