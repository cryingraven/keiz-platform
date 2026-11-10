import type { DocumentType } from '@keiz/shared';

export interface DocumentLine {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface DocumentCounterparty {
  name: string;
  email: string;
  taxId?: string;
  billingAddress?: string;
}

export interface LoadedDocument {
  kind: DocumentType;
  number: string;
  status: string;
  issueDate: Date;
  dueDate: Date;
  currency: string;
  decimals: number;
  lineItems: DocumentLine[];
  subtotal: string;
  taxBps: number;
  taxAmount: string;
  total: string;
  paidAmount?: string;
  notes?: string;
  counterparty: DocumentCounterparty;
  organizationName: string;
}

export interface PublicDocument extends Omit<LoadedDocument, 'issueDate' | 'dueDate' | 'status'> {
  title: 'Bill' | 'Invoice';
  status: string;
  issueDate: string;
  dueDate: string;
  amountDue?: string;
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
