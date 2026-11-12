import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CollectionQuoteInput } from '@keiz/shared';
import { PaymentProviderFactory } from '../payments/payment-provider.factory';
import { ArCollectionService } from '../receivables/ar-collection.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { EffectiveArMode, OrgPaymentsService } from '../users/org-payments.service';
import { DocumentsService } from './documents.service';

export interface PublicPayAsset {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
}

export interface PublicPayQuote {
  quoteId: string;
  mode: 'CONTRACT' | 'TREASURY';
  depositAddress: string;
  depositMemo?: string;
  amountIn?: string;
  amountInFormatted?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  originAsset: string;
  originSymbol?: string;
  destinationSymbol?: string;
  originChain?: string;
  destinationChain?: string;
  destinationAddress: string;
  deadline?: string;
  reused?: boolean;
}

export interface PublicPayInfo {
  enabled: boolean;
  reason?: string;
  mode: EffectiveArMode;
  providerMode: 'mock' | 'intents';
  amountDue?: string;
  currency: string;
  decimals: number;
  assets: PublicPayAsset[];
  quote: PublicPayQuote | null;
}

export interface PublicPayStatus {
  status: string;
  paid: boolean;
  receivableStatus: string;
  amountDue: string;
  currency: string;
  decimals: number;
  destinationTxHashes: string[];
  refundReason?: string;
  error?: string;
}

/**
 * Public, share-token-scoped AR payment. The token resolves the org and the
 * receivable; no internal ids are accepted from the client.
 */
@Injectable()
export class PublicPaymentsService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly payments: OrgPaymentsService,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly collection: ArCollectionService,
    private readonly receivables: ReceivablesService,
  ) {}

  async info(token: string): Promise<PublicPayInfo> {
    const { share, document } = await this.documents.shareContext(token);
    const settings = await this.payments.resolve(share.orgId);
    const providerMode = this.providerFactory.get().mode;
    const base = {
      mode: settings.arMode,
      providerMode,
      currency: document.currency,
      decimals: document.decimals,
      assets: [] as PublicPayAsset[],
      quote: null as PublicPayQuote | null,
    };

    if (document.kind !== 'invoice') {
      return {
        ...base,
        enabled: false,
        reason: 'This bill is settled by the issuing workspace.',
      };
    }

    const receivable = await this.receivables.findOne(share.orgId, share.documentId);
    const amountDue = BigInt(receivable.total) - BigInt(receivable.paidAmount);

    let reason: string | undefined;
    if (providerMode !== 'intents') {
      reason = 'Online payment is unavailable in test mode.';
    } else if (settings.arMode === 'OFF') {
      reason = 'Online payment is disabled for this invoice.';
    } else if (amountDue <= 0n) {
      reason = 'This invoice is already paid.';
    } else if (
      settings.arMode === 'CONTRACT' &&
      settings.collection?.status !== 'ACTIVE'
    ) {
      reason = 'The workspace collection contract is not active yet.';
    } else if (settings.arMode === 'TREASURY' && !settings.treasuryAccountId) {
      reason = 'The workspace treasury is not configured.';
    }

    const enabled = !reason;
    const assets = enabled ? await this.publicAssets() : [];
    const open = enabled
      ? await this.collection.latestOpenQuote(share.orgId, share.documentId, 'SHARE')
      : null;

    return {
      ...base,
      enabled,
      reason,
      amountDue: amountDue.toString(),
      assets,
      quote: open ? this.toPublicQuote(open) : null,
    };
  }

  async quote(token: string, input: CollectionQuoteInput): Promise<PublicPayQuote> {
    const { share, document } = await this.documents.shareContext(token);
    if (document.kind !== 'invoice') {
      throw new BadRequestException('Only customer invoices can be paid online');
    }
    if (this.providerFactory.get().mode !== 'intents') {
      throw new BadRequestException('Online payment is unavailable in test mode');
    }
    const receivable = await this.receivables.findOne(share.orgId, share.documentId);
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(receivable.status)) {
      throw new BadRequestException('This invoice is not payable');
    }

    const existing = await this.collection.latestOpenQuote(
      share.orgId,
      share.documentId,
      'SHARE',
    );
    if (existing) return { ...this.toPublicQuote(existing), reused: true };

    const quote = await this.collection.quote(
      share.orgId,
      `public:${String(share._id)}`,
      share.documentId,
      input,
      'SHARE',
    );
    return {
      quoteId: quote.quoteId,
      mode: quote.mode,
      depositAddress: quote.depositAddress!,
      depositMemo: quote.depositMemo,
      amountIn: quote.amountIn,
      amountInFormatted: quote.amountInFormatted,
      amountOut: quote.amountOut,
      amountOutFormatted: quote.amountOutFormatted,
      originAsset: quote.originAsset,
      originSymbol: quote.originSymbol,
      destinationSymbol: quote.destinationSymbol,
      originChain: quote.originChain,
      destinationChain: quote.destinationChain,
      destinationAddress: quote.destinationAddress,
      deadline: quote.deadline,
      reused: false,
    };
  }

  async status(token: string, quoteId: string): Promise<PublicPayStatus> {
    // Allow polling after the share expires: the deposit may already be in flight.
    const { share, document } = await this.documents.shareContext(token, {
      requireActive: false,
    });
    if (document.kind !== 'invoice') {
      throw new NotFoundException('Payment not found');
    }
    const quote = await this.collection.findOne(share.orgId, quoteId);
    if (String(quote.receivableId) !== String(share.documentId)) {
      throw new NotFoundException('Payment not found');
    }
    const receivable = await this.receivables.findOne(share.orgId, share.documentId);
    const amountDue = BigInt(receivable.total) - BigInt(receivable.paidAmount);
    return {
      status: quote.status,
      paid:
        receivable.status === 'PAID' ||
        BigInt(receivable.paidAmount) >= BigInt(receivable.total),
      receivableStatus: receivable.status,
      amountDue: amountDue.toString(),
      currency: receivable.currency,
      decimals: receivable.decimals,
      destinationTxHashes: quote.destinationTxHashes ?? [],
      refundReason: quote.refundReason,
      error: quote.error,
    };
  }

  private async publicAssets(): Promise<PublicPayAsset[]> {
    const tokens = await this.providerFactory.get().getTokens();
    const seen = new Set<string>();
    return tokens
      .filter(
        (token) =>
          ['USDC', 'USDT'].includes(token.symbol.toUpperCase()) &&
          token.assetId.startsWith('nep141:'),
      )
      .filter((token) => {
        if (seen.has(token.assetId)) return false;
        seen.add(token.assetId);
        return true;
      })
      .map((token) => ({
        assetId: token.assetId,
        symbol: token.symbol.toUpperCase(),
        blockchain: token.blockchain,
        decimals: token.decimals,
      }))
      .sort(
        (a, b) =>
          a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain),
      );
  }

  private toPublicQuote(quote: {
    _id: unknown;
    mode: 'CONTRACT' | 'TREASURY';
    depositAddress: string;
    depositMemo?: string;
    amountIn?: string;
    amountInFormatted?: string;
    amount?: string;
    amountFormatted?: string;
    originAsset: string;
    originSymbol?: string;
    destinationSymbol?: string;
    originChain?: string;
    destinationChain?: string;
    destinationAddress: string;
    deadline?: Date;
  }): PublicPayQuote {
    return {
      quoteId: String(quote._id),
      mode: quote.mode,
      depositAddress: quote.depositAddress,
      depositMemo: quote.depositMemo,
      amountIn: quote.amountIn,
      amountInFormatted: quote.amountInFormatted,
      amountOut: quote.amount,
      amountOutFormatted: quote.amountFormatted,
      originAsset: quote.originAsset,
      originSymbol: quote.originSymbol,
      destinationSymbol: quote.destinationSymbol,
      originChain: quote.originChain,
      destinationChain: quote.destinationChain,
      destinationAddress: quote.destinationAddress,
      deadline: quote.deadline ? new Date(quote.deadline).toISOString() : undefined,
    };
  }
}
