import { PaymentStatus } from '@keiz/shared';

export interface TokenInfo {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price?: string;
  contractAddress?: string;
}

export interface QuoteParams {
  dry: boolean;
  originAsset: string;
  destinationAsset: string;
  /** Smallest unit of the asset the amount refers to (see swapType). */
  amount: string;
  swapType: 'EXACT_INPUT' | 'EXACT_OUTPUT';
  recipient: string;
  refundTo: string;
  slippageBps?: number;
  /** 1Click passes this to ft_transfer_call on a NEAR destination. */
  customRecipientMsg?: string;
}

export interface QuoteResult {
  correlationId: string;
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountIn?: string;
  maxAmountIn?: string;
  minAmountOut?: string;
  deadline: string;
  timeEstimate?: number;
  raw: unknown;
}

export interface StatusResult {
  status: PaymentStatus;
  rawStatus: string;
  swapDetails?: {
    amountIn?: string;
    amountOut?: string;
    originTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
    destinationTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
    refundReason?: string;
  };
  raw: unknown;
}

export interface PaymentProvider {
  readonly mode: 'mock' | 'intents';
  getTokens(): Promise<TokenInfo[]>;
  quote(params: QuoteParams): Promise<QuoteResult>;
  submitDeposit(params: {
    depositAddress: string;
    txHash: string;
    nearSenderAccount?: string;
  }): Promise<void>;
  getStatus(depositAddress: string, depositMemo?: string): Promise<StatusResult>;
}
