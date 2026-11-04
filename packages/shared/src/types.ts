export const ROLES = ['OWNER', 'ADMIN', 'APPROVER', 'MEMBER'] as const;
export type Role = (typeof ROLES)[number];

export const INVOICE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'PAYMENT_PENDING',
  'PAID',
  'VOID',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const RECEIVABLE_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'VOID',
] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

export const RECEIPT_METHODS = ['BANK_TRANSFER', 'ONCHAIN', 'CASH', 'CARD', 'OTHER'] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];

export const PAYMENT_STATUSES = [
  'QUOTED',
  'AWAITING_DEPOSIT',
  'PROCESSING',
  'SUCCEEDED',
  'UNDERPAID',
  'REFUNDED',
  'FAILED',
  'EXPIRED',
  'NEEDS_REVIEW',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TERMINAL_PAYMENT_STATUSES: PaymentStatus[] = [
  'SUCCEEDED',
  'UNDERPAID',
  'REFUNDED',
  'FAILED',
  'EXPIRED',
  'NEEDS_REVIEW',
];

export const AGENT_ACTION_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'REJECTED',
  'EXECUTED',
  'BLOCKED',
  'FAILED',
  'NEEDS_REVIEW',
] as const;
export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

/** 1Click status -> internal status. Never leak raw provider strings to the UI. */
export const ONECLICK_STATUS_MAP: Record<string, PaymentStatus> = {
  PENDING_DEPOSIT: 'AWAITING_DEPOSIT',
  KNOWN_DEPOSIT_TX: 'PROCESSING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCEEDED',
  INCOMPLETE_DEPOSIT: 'UNDERPAID',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
};

export interface InvoiceLineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface AgentPolicy {
  perTxLimitUsd: string;
  dailyLimitUsd: string;
  approvalThresholdUsd: string;
  allowedAssets: string[];
  active: boolean;
}

export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  perTxLimitUsd: '500',
  dailyLimitUsd: '1500',
  approvalThresholdUsd: '250',
  allowedAssets: ['nep141:usdc.near'],
  active: true,
};
