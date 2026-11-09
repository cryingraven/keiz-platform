import { z } from 'zod';

export const CHAT_CARD_KINDS = [
  'invoice-list',
  'invoice',
  'spend-summary',
  'books-summary',
  'vendor-list',
  'vendor',
  'customer-list',
  'customer',
  'receivable-list',
  'receivable',
  'payment-list',
  'payment',
  'agent-action',
  'agent-action-list',
  'journal-list',
  'plan',
] as const;

export type ChatCardKind = (typeof CHAT_CARD_KINDS)[number];

export const CHAT_RISKS = ['read', 'write', 'spend'] as const;
export type ChatRisk = (typeof CHAT_RISKS)[number];

export const chatCardLinkSchema = z.object({
  href: z.string().min(1).max(300),
  label: z.string().min(1).max(60),
});
export type ChatCardLink = z.infer<typeof chatCardLinkSchema>;

export const chatMoneySchema = z.object({
  currency: z.string().min(1).max(12),
  decimals: z.number().int().min(0).max(18),
  /** Integer minor units as a string. */
  minor: z.string().max(40),
  /** Major units, already formatted for display. */
  formatted: z.string().max(40),
});
export type ChatMoney = z.infer<typeof chatMoneySchema>;

const id = z.string().min(1).max(80);
const dateString = z.string().max(40);
const statusString = z.string().min(1).max(40);

export const invoiceCardRowSchema = z.object({
  id,
  number: z.string().min(1).max(40),
  vendorId: id,
  vendorName: z.string().max(120).optional(),
  status: statusString,
  issueDate: dateString,
  dueDate: dateString,
  paidAt: dateString.optional(),
  lineCount: z.number().int().min(0),
  subtotal: chatMoneySchema,
  tax: chatMoneySchema,
  total: chatMoneySchema,
  link: chatCardLinkSchema,
});
export type InvoiceCardRow = z.infer<typeof invoiceCardRowSchema>;

export const invoiceLineCardSchema = z.object({
  description: z.string().max(300),
  quantity: z.string().max(40),
  unitPrice: z.string().max(40),
  lineTotal: chatMoneySchema,
});
export type InvoiceLineCard = z.infer<typeof invoiceLineCardSchema>;

export const invoiceApprovalCardSchema = z.object({
  accountId: z.string().max(80),
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().max(1000).optional(),
  at: dateString,
});

export const vendorCardRowSchema = z.object({
  id,
  name: z.string().max(120),
  email: z.string().max(200),
  nearAccountId: z.string().max(80).optional(),
  payoutChain: z.string().max(40),
  payoutAddress: z.string().max(200),
  bankName: z.string().max(120).optional(),
  bankAccount: z.string().max(80).optional(),
  status: statusString,
  link: chatCardLinkSchema,
});
export type VendorCardRow = z.infer<typeof vendorCardRowSchema>;

export const customerCardRowSchema = z.object({
  id,
  name: z.string().max(120),
  email: z.string().max(200),
  taxId: z.string().max(80).optional(),
  billingAddress: z.string().max(300).optional(),
  status: statusString,
  link: chatCardLinkSchema,
});
export type CustomerCardRow = z.infer<typeof customerCardRowSchema>;

export const receivableCardRowSchema = z.object({
  id,
  number: z.string().min(1).max(40),
  customerId: id,
  customerName: z.string().max(120).optional(),
  status: statusString,
  issueDate: dateString,
  dueDate: dateString,
  total: chatMoneySchema,
  paid: chatMoneySchema,
  outstanding: chatMoneySchema,
  link: chatCardLinkSchema,
});
export type ReceivableCardRow = z.infer<typeof receivableCardRowSchema>;

export const receivableReceiptCardSchema = z.object({
  receiptId: z.string().max(80),
  amount: chatMoneySchema,
  receivedAt: dateString,
  method: z.string().max(40),
  reference: z.string().max(200).optional(),
  txHash: z.string().max(200).optional(),
});

export const paymentCardRowSchema = z.object({
  id,
  invoiceId: id.optional(),
  invoiceNumber: z.string().max(40).optional(),
  provider: z.string().max(40),
  status: statusString,
  payer: z.string().max(20),
  originSymbol: z.string().max(40).optional(),
  destinationSymbol: z.string().max(40).optional(),
  destinationChain: z.string().max(40).optional(),
  amountIn: chatMoneySchema.optional(),
  amountOut: chatMoneySchema.optional(),
  depositAddress: z.string().max(200).optional(),
  deadline: dateString.optional(),
  createdAt: dateString,
  link: chatCardLinkSchema,
});
export type PaymentCardRow = z.infer<typeof paymentCardRowSchema>;

export const paymentEventCardSchema = z.object({
  id,
  status: z.string().max(40),
  rawStatus: z.string().max(80).optional(),
  at: dateString,
});
export type PaymentEventCard = z.infer<typeof paymentEventCardSchema>;

export const agentActionCardSchema = z.object({
  id,
  invoiceId: id,
  status: statusString,
  asset: z.string().max(200),
  amountUsd: z.string().max(40),
  reason: z.string().max(1000).optional(),
  createdAt: dateString,
  link: chatCardLinkSchema,
});
export type AgentActionCard = z.infer<typeof agentActionCardSchema>;

export const journalLineCardSchema = z.object({
  accountCode: z.string().max(20),
  accountName: z.string().max(120).optional(),
  debit: chatMoneySchema,
  credit: chatMoneySchema,
});

export const journalCardRowSchema = z.object({
  id,
  date: dateString,
  memo: z.string().max(500),
  sourceType: z.string().max(40),
  sourceId: z.string().max(80),
  event: z.string().max(40),
  currency: z.string().max(12),
  lines: z.array(journalLineCardSchema).max(50),
  link: chatCardLinkSchema,
});
export type JournalCardRow = z.infer<typeof journalCardRowSchema>;

export const spendSummaryRowSchema = z.object({
  status: z.string().max(40),
  currency: z.string().max(12),
  count: z.number().int().min(0),
  total: chatMoneySchema,
});
export type SpendSummaryRow = z.infer<typeof spendSummaryRowSchema>;

export const trialBalanceRowSchema = z.object({
  code: z.string().max(20),
  name: z.string().max(120),
  type: z.string().max(20),
  normalBalance: z.enum(['debit', 'credit']),
  debit: chatMoneySchema,
  credit: chatMoneySchema,
  balance: chatMoneySchema,
});

export const CHAT_PLAN_STATUSES = ['pending', 'approved', 'declined'] as const;
export type ChatPlanStatus = (typeof CHAT_PLAN_STATUSES)[number];

export const chatPlanStepSchema = z.object({
  title: z.string().min(1).max(160),
  detail: z.string().max(500).optional(),
  tool: z.string().max(60).optional(),
  risk: z.enum(CHAT_RISKS).default('read'),
});
export type ChatPlanStep = z.infer<typeof chatPlanStepSchema>;

export const chatPlanSchema = z.object({
  id: z.string().min(1).max(120),
  goal: z.string().min(1).max(500),
  summary: z.string().max(500).optional(),
  steps: z.array(chatPlanStepSchema).min(1).max(12),
  status: z.enum(CHAT_PLAN_STATUSES).default('pending'),
});
export type ChatPlan = z.infer<typeof chatPlanSchema>;

const baseShape = {
  title: z.string().min(1).max(160),
  subtitle: z.string().max(300).optional(),
  link: chatCardLinkSchema,
  relatedLinks: z.array(chatCardLinkSchema).max(8).optional(),
};

export const invoiceListCardSchema = z.object({
  kind: z.literal('invoice-list'),
  ...baseShape,
  data: z.object({
    invoices: z.array(invoiceCardRowSchema).max(100),
    count: z.number().int().min(0),
    filter: z.string().max(60).optional(),
  }),
});

export const invoiceCardSchema = z.object({
  kind: z.literal('invoice'),
  ...baseShape,
  data: z.object({
    invoice: invoiceCardRowSchema,
    lines: z.array(invoiceLineCardSchema).max(100),
    approvals: z.array(invoiceApprovalCardSchema).max(50),
    notes: z.string().max(2000).optional(),
    payments: z.array(paymentCardRowSchema).max(20).optional(),
  }),
});

export const spendSummaryCardSchema = z.object({
  kind: z.literal('spend-summary'),
  ...baseShape,
  data: z.object({
    byStatus: z.array(spendSummaryRowSchema).max(100),
    vendorCount: z.number().int().min(0),
  }),
});

export const booksSummaryCardSchema = z.object({
  kind: z.literal('books-summary'),
  ...baseShape,
  data: z.object({
    currency: z.string().max(12),
    from: dateString,
    to: dateString,
    cash: chatMoneySchema,
    receivable: chatMoneySchema,
    payable: chatMoneySchema,
    inputTax: chatMoneySchema,
    taxPayable: chatMoneySchema,
    revenue: chatMoneySchema,
    expenses: chatMoneySchema,
    netIncome: chatMoneySchema,
    trialBalance: z.object({
      rows: z.array(trialBalanceRowSchema).max(100),
      totals: z.object({
        debit: chatMoneySchema,
        credit: chatMoneySchema,
        balanced: z.boolean(),
      }),
    }),
  }),
});

export const vendorListCardSchema = z.object({
  kind: z.literal('vendor-list'),
  ...baseShape,
  data: z.object({ vendors: z.array(vendorCardRowSchema).max(100) }),
});

export const vendorCardSchema = z.object({
  kind: z.literal('vendor'),
  ...baseShape,
  data: z.object({
    vendor: vendorCardRowSchema,
    bills: z.array(invoiceCardRowSchema).max(20).optional(),
  }),
});

export const customerListCardSchema = z.object({
  kind: z.literal('customer-list'),
  ...baseShape,
  data: z.object({ customers: z.array(customerCardRowSchema).max(100) }),
});

export const customerCardSchema = z.object({
  kind: z.literal('customer'),
  ...baseShape,
  data: z.object({
    customer: customerCardRowSchema,
    receivables: z.array(receivableCardRowSchema).max(20).optional(),
  }),
});

export const receivableListCardSchema = z.object({
  kind: z.literal('receivable-list'),
  ...baseShape,
  data: z.object({ receivables: z.array(receivableCardRowSchema).max(100) }),
});

export const receivableCardSchema = z.object({
  kind: z.literal('receivable'),
  ...baseShape,
  data: z.object({
    receivable: receivableCardRowSchema,
    receipts: z.array(receivableReceiptCardSchema).max(50),
  }),
});

export const paymentListCardSchema = z.object({
  kind: z.literal('payment-list'),
  ...baseShape,
  data: z.object({ payments: z.array(paymentCardRowSchema).max(100) }),
});

export const paymentCardSchema = z.object({
  kind: z.literal('payment'),
  ...baseShape,
  data: z.object({
    payment: paymentCardRowSchema,
    events: z.array(paymentEventCardSchema).max(100),
  }),
});

export const agentActionListCardSchema = z.object({
  kind: z.literal('agent-action-list'),
  ...baseShape,
  data: z.object({ actions: z.array(agentActionCardSchema).max(100) }),
});

export const agentActionCardEnvelopeSchema = z.object({
  kind: z.literal('agent-action'),
  ...baseShape,
  data: z.object({ action: agentActionCardSchema }),
});

export const journalListCardSchema = z.object({
  kind: z.literal('journal-list'),
  ...baseShape,
  data: z.object({ entries: z.array(journalCardRowSchema).max(100) }),
});

export const planCardSchema = z.object({
  kind: z.literal('plan'),
  ...baseShape,
  data: z.object({ plan: chatPlanSchema }),
});

export const chatCardSchema = z.discriminatedUnion('kind', [
  invoiceListCardSchema,
  invoiceCardSchema,
  spendSummaryCardSchema,
  booksSummaryCardSchema,
  vendorListCardSchema,
  vendorCardSchema,
  customerListCardSchema,
  customerCardSchema,
  receivableListCardSchema,
  receivableCardSchema,
  paymentListCardSchema,
  paymentCardSchema,
  agentActionCardEnvelopeSchema,
  agentActionListCardSchema,
  journalListCardSchema,
  planCardSchema,
]);
export type ChatCard = z.infer<typeof chatCardSchema>;
export type ChatCardOf<K extends ChatCardKind> = Extract<ChatCard, { kind: K }>;

export const chatToolErrorSchema = z.object({ error: z.string().max(1000) });
export type ChatToolError = z.infer<typeof chatToolErrorSchema>;
