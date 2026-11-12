export type DocumentType = 'bill' | 'invoice';

export interface DocumentLine {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface PublicDocument {
  kind: DocumentType;
  title: 'Bill' | 'Invoice';
  number: string;
  status: string;
  organizationName: string;
  counterparty: {
    name: string;
    email: string;
    taxId?: string;
    billingAddress?: string;
  };
  issueDate: string;
  dueDate: string;
  currency: string;
  decimals: number;
  lineItems: DocumentLine[];
  subtotal: string;
  taxBps: number;
  taxAmount: string;
  total: string;
  paidAmount?: string;
  amountDue?: string;
  notes?: string;
  expiresAt?: string;
}

export interface DocumentShareMeta {
  active: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
}

export interface CreatedDocumentShare {
  token: string;
  path: string;
  expiresAt: string;
}

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
  mode: 'CONTRACT' | 'TREASURY' | 'OFF';
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
