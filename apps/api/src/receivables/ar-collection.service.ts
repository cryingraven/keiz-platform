import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CollectionQuoteInput,
  formatUnits,
  parseUnits,
  PaymentStatus,
  USD_STABLE_SYMBOLS,
  validatePayoutAddress,
} from '@keiz/shared';
import { PaymentProviderFactory } from '../payments/payment-provider.factory';
import { StatusResult, TokenInfo } from '../payments/providers/provider';
import { EffectiveArMode, OrgPaymentsService } from '../users/org-payments.service';
import {
  ArCollectionQuote,
  ArCollectionQuoteDocument,
  ArQuoteSource,
  ArQuoteStatus,
} from './ar-quote.schema';
import { Receivable, ReceivableDocument } from './receivable.schema';
import { ReceivablesService } from './receivables.service';

const OPEN_QUOTE_STATUSES: ArQuoteStatus[] = ['AWAITING_DEPOSIT', 'PROCESSING'];
const TERMINAL_QUOTE_STATUSES: ArQuoteStatus[] = [
  'SUCCEEDED',
  'FAILED',
  'REFUNDED',
  'UNDERPAID',
  'NEEDS_REVIEW',
  'OVERPAID',
  'EXPIRED',
];

/**
 * Builds the 1Click quote a customer uses to pay a receivable from another
 * chain. CONTRACT mode delivers to `keiz-collect` with the receivable ref in
 * `customRecipientMsg`; TREASURY mode delivers to a plain NEAR account and the
 * poller records the receipt from the delivery transaction.
 */
@Injectable()
export class ArCollectionService {
  private readonly logger = new Logger(ArCollectionService.name);

  constructor(
    @InjectModel(Receivable.name) private readonly receivables: Model<ReceivableDocument>,
    @InjectModel(ArCollectionQuote.name)
    private readonly quotes: Model<ArCollectionQuoteDocument>,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly payments: OrgPaymentsService,
    private readonly receivablesService: ReceivablesService,
  ) {}

  async quote(
    orgId: string,
    userId: string,
    receivableId: string,
    input: CollectionQuoteInput,
    source: ArQuoteSource = 'DASHBOARD',
  ) {
    const receivable = await this.receivables.findOne({ _id: receivableId, orgId }).lean();
    if (!receivable) throw new NotFoundException('Receivable not found');
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(receivable.status)) {
      throw new BadRequestException(`Cannot collect a ${receivable.status} receivable`);
    }

    const settings = await this.payments.resolve(orgId);
    const mode = settings.arMode;
    if (mode === 'OFF') {
      throw new BadRequestException(
        'On-chain AR collection is disabled for this workspace. Choose a collection mode in Settings → Payments.',
      );
    }

    let destinationAddress: string;
    let destinationAssetId: string;
    let customRecipientMsg: string | undefined;
    if (mode === 'CONTRACT') {
      const collection = settings.collection;
      if (!collection || collection.status !== 'ACTIVE') {
        const state = collection
          ? `current status is ${collection.status}`
          : 'no contract is configured';
        throw new BadRequestException(
          `On-chain AR collection is not active for this workspace (${state}). ` +
            'Deploy or activate a keiz-collect contract in Settings → AR collection, ' +
            'or switch to treasury mode.',
        );
      }
      destinationAddress = collection.contractId;
      destinationAssetId = collection.assetId;
      customRecipientMsg = JSON.stringify({
        orgId,
        receivableRef: receivable.number,
      });
    } else {
      if (!settings.treasuryAccountId) {
        throw new BadRequestException(
          'No AR treasury account is configured. Set one in Settings → Payments.',
        );
      }
      destinationAddress = settings.treasuryAccountId;
      destinationAssetId = settings.arAssetId ?? '';
    }

    const provider = this.providerFactory.get();
    const tokens = await provider.getTokens();
    const origin = tokens.find((token) => token.assetId === input.originAsset);
    if (!origin) {
      throw new BadRequestException('The origin asset is not in the 1Click token list');
    }
    if (!(USD_STABLE_SYMBOLS as readonly string[]).includes(origin.symbol.toUpperCase())) {
      throw new BadRequestException('Only USDC or USDT can be used to pay a receivable');
    }
    const refundError = validatePayoutAddress(origin.blockchain, input.refundTo);
    if (refundError && !refundError.startsWith('Unsupported payout chain')) {
      throw new BadRequestException(`Refund address is invalid: ${refundError}`);
    }
    const destination = this.resolveDestination(tokens, destinationAssetId, mode);

    const outstanding = BigInt(receivable.total) - BigInt(receivable.paidAmount);
    if (outstanding <= 0n) throw new BadRequestException('Receivable is fully paid');

    const amount = parseUnits(
      formatUnits(outstanding.toString(), receivable.decimals),
      destination.decimals,
    ).toString();

    const quote = await provider.quote({
      dry: false,
      swapType: 'EXACT_OUTPUT',
      originAsset: input.originAsset,
      destinationAsset: destination.assetId,
      amount,
      recipient: destinationAddress,
      refundTo: input.refundTo,
      ...(customRecipientMsg ? { customRecipientMsg } : {}),
    });
    if (!quote.depositAddress) {
      throw new BadRequestException('1Click did not return a deposit address');
    }

    const saved = await this.quotes.create({
      orgId,
      receivableId: String(receivable._id),
      receivableNumber: receivable.number,
      mode,
      source,
      destinationAddress,
      destinationAssetId: destination.assetId,
      decimals: destination.decimals,
      originAsset: input.originAsset,
      refundTo: input.refundTo,
      depositAddress: quote.depositAddress,
      depositMemo: quote.depositMemo,
      correlationId: quote.correlationId,
      amount,
      amountFormatted: quote.amountOutFormatted,
      amountIn: quote.amountIn,
      amountInFormatted: quote.amountInFormatted,
      originSymbol: origin.symbol,
      destinationSymbol: destination.symbol,
      originChain: origin.blockchain,
      destinationChain: destination.blockchain,
      status: 'AWAITING_DEPOSIT',
      deadline: quote.deadline ? new Date(quote.deadline) : undefined,
      createdByUserId: userId,
    });

    return {
      quoteId: saved.id,
      receivableId,
      receivableNumber: receivable.number,
      mode,
      collectContractId: mode === 'CONTRACT' ? destinationAddress : undefined,
      destinationAddress,
      destinationAssetId: destination.assetId,
      originAsset: input.originAsset,
      originSymbol: origin.symbol,
      destinationSymbol: destination.symbol,
      originChain: origin.blockchain,
      destinationChain: destination.blockchain,
      ...quote,
    };
  }

  /** Polls open AR quotes and records treasury deliveries. Idempotent. */
  async syncOpenQuotes(limit = 20): Promise<number> {
    const provider = this.providerFactory.get();
    const open = await this.quotes
      .find({ status: { $in: OPEN_QUOTE_STATUSES } })
      .sort({ createdAt: 1 })
      .limit(limit);
    let changed = 0;

    for (const quote of open) {
      try {
        if (
          quote.status === 'AWAITING_DEPOSIT' &&
          quote.deadline &&
          quote.deadline.getTime() < Date.now()
        ) {
          await this.quotes.updateOne(
            { _id: quote._id, status: quote.status },
            { $set: { status: 'EXPIRED', expiredAt: new Date() } },
          );
          changed += 1;
          continue;
        }

        const result = await provider.getStatus(quote.depositAddress, quote.depositMemo);
        let status = this.mapStatus(result.status);
        const destinationTxHashes =
          result.swapDetails?.destinationTxHashes?.map((tx) => tx.hash) ?? [];
        const originTxHashes = result.swapDetails?.originTxHashes?.map((tx) => tx.hash) ?? [];
        if (
          status === 'SUCCEEDED' &&
          destinationTxHashes.length === 0 &&
          provider.mode !== 'mock'
        ) {
          status = 'NEEDS_REVIEW';
        }

        const updated = await this.quotes.findOneAndUpdate(
          { _id: quote._id, status: quote.status },
          {
            $set: {
              status,
              originTxHashes,
              destinationTxHashes,
              refundReason: result.swapDetails?.refundReason,
            },
          },
          { returnDocument: 'after' },
        );
        if (!updated) continue;
        changed += 1;

        if (status === 'SUCCEEDED' && updated.mode === 'TREASURY') {
          try {
            await this.applyTreasuryReceipt(updated, result);
          } catch (error) {
            await this.markReview(
              updated.id,
              `Delivered funds could not be recorded: ${(error as Error).message}`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `AR quote ${quote.id} status poll failed: ${(error as Error).message}`,
        );
      }
    }
    return changed;
  }

  private async applyTreasuryReceipt(
    quote: ArCollectionQuoteDocument,
    result: StatusResult,
  ): Promise<void> {
    const chainEventId = `arquote:${quote.id}`;
    if (await this.receivablesService.hasChainEvent(quote.orgId, chainEventId)) {
      return;
    }

    const receivable = await this.receivablesService.findOne(quote.orgId, quote.receivableId);
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(receivable.status)) {
      await this.markReview(quote.id, `Receivable is ${receivable.status}`);
      return;
    }
    const outstanding = BigInt(receivable.total) - BigInt(receivable.paidAmount);
    if (outstanding <= 0n) {
      await this.markReview(quote.id, 'Receivable is already fully paid');
      return;
    }

    const delivered = result.swapDetails?.amountOut ?? quote.amount;
    let received = this.toReceivableMinor(delivered, quote.decimals, receivable.decimals);
    if (received <= 0n) {
      await this.markReview(quote.id, 'Delivered amount is zero or below the receivable precision');
      return;
    }
    const overpaid = received > outstanding;
    if (overpaid) received = outstanding;

    const updated = await this.receivablesService.recordReceipt(
      quote.orgId,
      'system:ar-indexer',
      quote.receivableId,
      {
        amount: formatUnits(received.toString(), receivable.decimals),
        receivedAt: new Date().toISOString(),
        method: 'ONCHAIN',
        txHash: quote.destinationTxHashes[0],
        chainEventId,
        receivableRef: quote.receivableNumber,
        tokenContract: quote.destinationAssetId.replace(/^nep141:/, ''),
      },
    );
    const receipt = updated.receipts?.find((item) => item.chainEventId === chainEventId);
    await this.quotes.updateOne(
      { _id: quote._id },
      {
        $set: {
          status: overpaid ? 'OVERPAID' : 'SUCCEEDED',
          appliedReceiptId: receipt?.receiptId,
          appliedAt: new Date(),
        },
      },
    );
    this.logger.log(
      `Recorded ${overpaid ? 'partial (overpayment capped) ' : ''}AR receipt for quote ${quote.id}`,
    );
  }

  private async markReview(id: string, reason: string): Promise<void> {
    this.logger.warn(`AR quote ${id} needs review: ${reason}`);
    await this.quotes.updateOne(
      { _id: id },
      { $set: { status: 'NEEDS_REVIEW', error: reason } },
    );
  }

  private resolveDestination(
    tokens: TokenInfo[],
    assetId: string,
    mode: EffectiveArMode,
  ): TokenInfo {
    const nearStable = tokens.filter(
      (token) =>
        token.blockchain.toLowerCase() === 'near' &&
        token.assetId.startsWith('nep141:') &&
        (USD_STABLE_SYMBOLS as readonly string[]).includes(token.symbol.toUpperCase()),
    );

    if (mode === 'CONTRACT') {
      const configured = tokens.find((token) => token.assetId === assetId);
      if (!configured) {
        throw new BadRequestException(
          'The workspace collection asset is not in the 1Click token list',
        );
      }
      if (configured.blockchain.toLowerCase() !== 'near') {
        throw new BadRequestException('The collection asset must be a NEAR NEP-141 token');
      }
      return configured;
    }

    const match = assetId
      ? nearStable.find((token) => token.assetId === assetId)
      : nearStable.find((token) => token.symbol.toUpperCase() === 'USDC') ?? nearStable[0];
    if (!match) {
      throw new BadRequestException(
        'No supported USDC/USDT asset is available for treasury collection',
      );
    }
    return match;
  }

  /** Convert between token decimals, truncating instead of rounding up. */
  private toReceivableMinor(amount: string, from: number, to: number): bigint {
    const formatted = formatUnits(amount, from);
    const [whole, fraction = ''] = formatted.split('.');
    const truncated = to === 0 ? whole : `${whole}.${fraction.slice(0, to) || '0'}`;
    try {
      return BigInt(parseUnits(truncated, to));
    } catch {
      return 0n;
    }
  }

  private mapStatus(status: PaymentStatus): ArQuoteStatus {
    switch (status) {
      case 'SUCCEEDED':
        return 'SUCCEEDED';
      case 'FAILED':
        return 'FAILED';
      case 'REFUNDED':
        return 'REFUNDED';
      case 'UNDERPAID':
        return 'UNDERPAID';
      case 'EXPIRED':
        return 'EXPIRED';
      case 'NEEDS_REVIEW':
        return 'NEEDS_REVIEW';
      case 'PROCESSING':
        return 'PROCESSING';
      default:
        return 'AWAITING_DEPOSIT';
    }
  }

  async findOne(orgId: string, id: string) {
    const quote = await this.quotes.findOne({ _id: id, orgId }).lean();
    if (!quote) throw new NotFoundException('Collection quote not found');
    return quote;
  }

  /** Latest unexpired quote that can still receive a deposit. */
  async latestOpenQuote(
    orgId: string,
    receivableId: string,
    source?: ArQuoteSource,
  ) {
    const filter: Record<string, unknown> = {
      orgId,
      receivableId,
      status: { $in: OPEN_QUOTE_STATUSES },
      $or: [{ deadline: { $exists: false } }, { deadline: { $gt: new Date() } }],
    };
    if (source) filter.source = source;
    return this.quotes
      .findOne(filter)
      .sort({ createdAt: -1 })
      .lean();
  }

  isTerminal(status: ArQuoteStatus): boolean {
    return TERMINAL_QUOTE_STATUSES.includes(status);
  }
}
