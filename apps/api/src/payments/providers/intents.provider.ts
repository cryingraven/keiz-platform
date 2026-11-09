import { ONECLICK_STATUS_MAP } from '@keiz/shared';
import { PaymentProvider, QuoteParams, QuoteResult, StatusResult, TokenInfo } from './provider';

interface OneClickQuoteResponse {
  correlationId: string;
  quote: {
    depositAddress?: string;
    depositMemo?: string | null;
    amountIn: string;
    amountInFormatted: string;
    amountOut: string;
    amountOutFormatted: string;
    minAmountIn?: string;
    maxAmountIn?: string;
    minAmountOut?: string;
    deadline: string;
    timeEstimate?: number;
  };
}

export interface IntentsProviderConfig {
  baseUrl: string;
  jwt?: string;
  referral?: string;
}

/**
 * NEAR Intents 1Click adapter.
 * MAINNET ONLY - 1Click has no testnet deployment. Keep PAYMENTS_MODE=mock in CI.
 */
export class IntentsPaymentProvider implements PaymentProvider {
  readonly mode = 'intents' as const;
  private tokenCache?: { at: number; tokens: TokenInfo[] };

  constructor(private readonly config: IntentsProviderConfig) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.jwt) headers.authorization = `Bearer ${this.config.jwt}`;
    return headers;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`1Click ${path} failed (${response.status}): ${text.slice(0, 500)}`);
    }
    return JSON.parse(text) as T;
  }

  async getTokens(): Promise<TokenInfo[]> {
    // Asset IDs change; they are only ever read from this endpoint, never built by hand.
    if (this.tokenCache && Date.now() - this.tokenCache.at < 60 * 60 * 1000) {
      return this.tokenCache.tokens;
    }
    const raw = await this.request<
      Array<{
        assetId: string;
        symbol: string;
        blockchain: string;
        decimals: number;
        price?: string;
        contractAddress?: string;
      }>
    >('/v0/tokens');
    const tokens = raw.map((t) => ({
      assetId: t.assetId,
      symbol: t.symbol,
      blockchain: t.blockchain,
      decimals: t.decimals,
      price: t.price,
      contractAddress: t.contractAddress,
    }));
    this.tokenCache = { at: Date.now(), tokens };
    return tokens;
  }

  async quote(params: QuoteParams): Promise<QuoteResult> {
    const body = {
      dry: params.dry,
      swapType: params.swapType,
      originAsset: params.originAsset,
      destinationAsset: params.destinationAsset,
      amount: params.amount,
      recipient: params.recipient,
      refundTo: params.refundTo,
      slippageTolerance: params.slippageBps ?? 100,
      referral: this.config.referral,
      ...(params.customRecipientMsg
        ? { customRecipientMsg: params.customRecipientMsg, recipientType: 'DESTINATION_CHAIN' }
        : {}),
    };
    const data = await this.request<OneClickQuoteResponse>('/v0/quote', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return {
      correlationId: data.correlationId,
      depositAddress: data.quote.depositAddress,
      depositMemo: data.quote.depositMemo ?? undefined,
      amountIn: data.quote.amountIn,
      amountInFormatted: data.quote.amountInFormatted,
      amountOut: data.quote.amountOut,
      amountOutFormatted: data.quote.amountOutFormatted,
      minAmountIn: data.quote.minAmountIn,
      maxAmountIn: data.quote.maxAmountIn,
      minAmountOut: data.quote.minAmountOut,
      deadline: data.quote.deadline,
      timeEstimate: data.quote.timeEstimate,
      raw: data,
    };
  }

  async submitDeposit(params: {
    depositAddress: string;
    txHash: string;
    nearSenderAccount?: string;
  }): Promise<void> {
    await this.request('/v0/deposit/submit', {
      method: 'POST',
      body: JSON.stringify({
        depositAddress: params.depositAddress,
        txHash: params.txHash,
        nearSenderAccount: params.nearSenderAccount,
      }),
    });
  }

  async getStatus(depositAddress: string, depositMemo?: string): Promise<StatusResult> {
    const query = new URLSearchParams({ depositAddress });
    if (depositMemo) query.set('depositMemo', depositMemo);
    const data = await this.request<{
      status: string;
      swapDetails?: {
        amountIn?: string;
        amountOut?: string;
        originChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
        destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
        refundReason?: string;
      };
    }>(`/v0/status?${query.toString()}`);
    const mapped = ONECLICK_STATUS_MAP[data.status];
    if (!mapped) throw new Error(`Unknown 1Click status: ${data.status}`);
    return {
      status: mapped,
      rawStatus: data.status,
      swapDetails: data.swapDetails
        ? {
            amountIn: data.swapDetails.amountIn,
            amountOut: data.swapDetails.amountOut,
            originTxHashes: data.swapDetails.originChainTxHashes,
            destinationTxHashes: data.swapDetails.destinationChainTxHashes,
            refundReason: data.swapDetails.refundReason,
          }
        : undefined,
      raw: data,
    };
  }
}
