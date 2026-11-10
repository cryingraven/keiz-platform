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
