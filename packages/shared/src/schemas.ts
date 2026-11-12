import { z } from 'zod';
import { invoiceNumber, payoutChain, positiveDecimal, validatePayoutAddress } from './validation';
import { RECEIPT_METHODS, RECEIVABLE_STATUSES, ROLES } from './types';

export const NEAR_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const nearAccountId = z
  .string()
  .min(2)
  .max(64)
  .regex(NEAR_ACCOUNT_RE, 'Invalid NEAR account id');

export const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  SGD: 2,
  IDR: 2,
};

export const currencySchema = z.enum(['USD', 'EUR', 'SGD', 'IDR']);

export const loginChallengeSchema = z.object({
  accountId: nearAccountId,
  network: z.enum(['mainnet', 'testnet']).default('mainnet'),
});

export const loginVerifySchema = z.object({
  accountId: nearAccountId,
  publicKey: z.string().min(10).max(200),
  signature: z.string().min(10).max(500),
  nonce: z.string().min(10).max(200),
  recipient: z.string().min(1).max(200),
});

export const switchOrgSchema = z.object({
  orgId: z.string().min(1).max(64),
});

/** WebAuthn responses are verified by @simplewebauthn/server, not Zod. */
const webauthnCredentialJson = z.object({
  id: z.string().min(1).max(2048),
  rawId: z.string().min(1).max(2048),
  type: z.literal('public-key'),
  response: z.record(z.string(), z.unknown()),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  authenticatorAttachment: z.string().optional(),
});

export const wrappedSeedSchema = z.object({
  v: z.literal(1),
  nonce: z.string().min(12).max(64),
  ciphertext: z.string().min(16).max(512),
});

export const passkeySignupOptionsSchema = z.object({
  accountId: z.string().length(64).regex(/^[0-9a-f]+$/i, 'Implicit account must be hex'),
  nearPublicKey: z.string().min(10).max(100),
});

export const passkeySignupVerifySchema = passkeySignupOptionsSchema.extend({
  credential: webauthnCredentialJson,
  wrappedSeed: wrappedSeedSchema,
  nep413: loginVerifySchema,
});

export const passkeyLoginOptionsSchema = z.object({}).default({});

export const passkeyLoginVerifySchema = z.object({
  credential: webauthnCredentialJson,
  accountId: z.string().min(2).max(64).optional(),
});

export const passkeyCredentialOptionsSchema = z.object({
  nearPublicKey: z.string().min(10).max(100),
});

export const passkeyCredentialVerifySchema = z.object({
  nearPublicKey: z.string().min(10).max(100),
  credential: webauthnCredentialJson,
  wrappedSeed: wrappedSeedSchema,
  nep413: loginVerifySchema,
});

export const passkeyUnlockSchema = z.object({
  credentialId: z.string().min(1).max(2048),
});

export type PasskeySignupVerifyInput = z.infer<typeof passkeySignupVerifySchema>;
export type PasskeyCredentialVerifyInput = z.infer<typeof passkeyCredentialVerifySchema>;

export const createVendorSchema = z
  .object({
    name: z.string().min(1).max(120),
    email: z.email(),
    nearAccountId: nearAccountId.optional().or(z.literal('')),
    payoutChain: payoutChain.default('near'),
    payoutAddress: z.string().min(2).max(200),
    bankName: z.string().max(120).optional(),
    bankAccount: z.string().max(60).optional(),
  })
  .superRefine((value, ctx) => {
    const error = validatePayoutAddress(value.payoutChain, value.payoutAddress);
    if (error) {
      ctx.addIssue({ code: 'custom', path: ['payoutAddress'], message: error });
    }
    if (value.nearAccountId) {
      const nearError = validatePayoutAddress('near', value.nearAccountId);
      if (nearError) {
        ctx.addIssue({ code: 'custom', path: ['nearAccountId'], message: nearError });
      }
    }
  });

export const invoiceLineItemSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: positiveDecimal,
  unitPrice: positiveDecimal,
});

export const createInvoiceSchema = z.object({
  vendorId: z.string().min(1),
  number: invoiceNumber,
  issueDate: z.iso.datetime().optional(),
  dueDate: z.iso.datetime(),
  currency: currencySchema.default('USD'),
  taxBps: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().max(2000).optional(),
  lineItems: z.array(invoiceLineItemSchema).min(1).max(50),
});

export const invoiceDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().max(1000).optional(),
});

/** Draft bills can be fully replaced; totals are recomputed server-side. */
export const updateInvoiceSchema = createInvoiceSchema;

/** Vendors and customers can be fully updated; archived records are hidden. */
export const updateVendorSchema = createVendorSchema;

export const memberRoleSchema = z.enum(ROLES);
export const createMemberSchema = z.object({
  accountId: nearAccountId,
  role: memberRoleSchema.default('MEMBER'),
});
export const updateMemberSchema = z.object({ role: memberRoleSchema });

export const createCustomerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email(),
  taxId: z.string().max(60).optional(),
  billingAddress: z.string().max(300).optional(),
});

/** Customers can be fully updated; archived records are hidden from lists. */
export const updateCustomerSchema = createCustomerSchema;

export const createReceivableSchema = z.object({
  customerId: z.string().min(1),
  number: invoiceNumber,
  issueDate: z.iso.datetime().optional(),
  dueDate: z.iso.datetime(),
  currency: currencySchema.default('USD'),
  taxBps: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().max(2000).optional(),
  lineItems: z.array(invoiceLineItemSchema).min(1).max(50),
});

export const recordReceiptSchema = z.object({
  amount: positiveDecimal,
  receivedAt: z.iso.datetime().optional(),
  method: z.enum(RECEIPT_METHODS).default('BANK_TRANSFER'),
  reference: z.string().max(200).optional(),
  txHash: z.string().max(200).optional(),
  chainEventId: z.string().max(200).optional(),
  receivableRef: z.string().max(64).optional(),
  tokenContract: z.string().max(64).optional(),
  sender: z.string().max(64).optional(),
});

export const collectionQuoteSchema = z.object({
  originAsset: z.string().min(1).max(200),
  refundTo: z.string().min(1).max(200),
});

export const orgCollectionSchema = z.object({
  contractId: nearAccountId,
  treasury: nearAccountId,
  assetId: z.string().min(1).max(200),
  tokenContract: nearAccountId,
  decimals: z.number().int().min(0).max(18),
  status: z.enum(['PENDING', 'ACTIVE', 'PAUSED', 'DISABLED']).default('ACTIVE'),
});

/** Workspace-level AR rail selection. Contracts are optional. */
export const AR_COLLECTION_MODES = ['CONTRACT', 'TREASURY', 'OFF'] as const;
export const arCollectionMode = z.enum(AR_COLLECTION_MODES);
export type ArCollectionMode = (typeof AR_COLLECTION_MODES)[number];

export const orgPaymentsSchema = z.object({
  arMode: arCollectionMode,
  treasuryAccountId: nearAccountId.optional(),
  /** 1Click asset id delivered to the treasury in TREASURY mode. */
  arAssetId: z.string().min(1).max(200).optional(),
});

export type OrgPaymentsInput = z.infer<typeof orgPaymentsSchema>;

/**
 * One-click deployment of a workspace `keiz-collect` contract. The asset must
 * come from the 1Click token list; the server derives the NEP-141 contract.
 */
export const collectionDeploySchema = z.object({
  assetId: z.string().min(3).max(200),
  treasury: nearAccountId.optional(),
  prefix: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      'Use lowercase letters, numbers and hyphens',
    )
    .optional(),
});

export type CollectionDeployInput = z.infer<typeof collectionDeploySchema>;

export const orgSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lowercase letters, numbers and single hyphens',
  );

export const updateOrganizationProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    slug: orgSlugSchema.optional(),
    baseCurrency: currencySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one workspace field to update',
  });

const journalAmount = z
  .string()
  .max(40)
  .regex(/^\d+(\.\d{1,18})?$/, 'Use a non-negative amount')
  .default('0');

export const journalLineSchema = z.object({
  accountCode: z.string().min(1).max(20),
  debit: journalAmount,
  credit: journalAmount,
});

export const manualJournalSchema = z.object({
  date: z.iso.datetime().optional(),
  memo: z.string().min(1).max(500),
  currency: currencySchema.default('USD'),
  lines: z.array(journalLineSchema).min(2).max(50),
});

export const createPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  originAsset: z.string().max(200).default(''),
  destinationAsset: z.string().max(200).optional(),
  slippageBps: z.number().int().min(0).max(5000).default(100),
  payer: z.enum(['USER', 'AGENT']).default('USER'),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const confirmDepositSchema = z.object({
  txHash: z.string().min(8).max(200),
});

const usdAmount = z
  .string()
  .max(40)
  .regex(/^\d+(\.\d{1,2})?$/, 'Use a non-negative USD amount with at most 2 decimals');

export const agentPolicySchema = z
  .object({
    perTxLimitUsd: usdAmount,
    dailyLimitUsd: usdAmount,
    approvalThresholdUsd: usdAmount,
    allowedAssets: z.array(z.string().min(3).max(200)).min(1).max(20),
    active: z.boolean(),
  })
  .refine((value) => Number(value.perTxLimitUsd) <= Number(value.dailyLimitUsd), {
    path: ['perTxLimitUsd'],
    message: 'Per-transaction limit cannot exceed the daily limit',
  });

export const proposeAgentPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  asset: z.string().min(3),
  reason: z.string().max(1000).optional(),
});

export const agentSwapQuoteSchema = z.object({
  amountNear: positiveDecimal,
});

export const agentSwapSchema = z.object({
  amountNear: positiveDecimal,
  minAmountOut: z
    .string()
    .regex(/^\d+$/, 'minAmountOut must be an integer in token minor units')
    .optional(),
});

export type AgentSwapQuoteInput = z.infer<typeof agentSwapQuoteSchema>;
export type AgentSwapInput = z.infer<typeof agentSwapSchema>;

export const agentIntentsDepositSchema = z.object({
  amountUsdc: positiveDecimal.optional(),
});

export type AgentIntentsDepositInput = z.infer<typeof agentIntentsDepositSchema>;

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  threadId: z.string().optional(),
});

export const chatApprovalSchema = z.object({
  runId: z.string().min(1).max(200),
  threadId: z.string().min(1).max(200),
  toolCallId: z.string().min(1).max(200),
  approved: z.boolean(),
  reason: z.string().max(500).optional(),
});

export type LoginChallengeInput = z.infer<typeof loginChallengeSchema>;
export type LoginVerifyInput = z.infer<typeof loginVerifySchema>;
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateReceivableInput = z.infer<typeof createReceivableSchema>;
export type RecordReceiptInput = z.infer<typeof recordReceiptSchema>;
export type CollectionQuoteInput = z.infer<typeof collectionQuoteSchema>;
export type OrgCollectionInput = z.infer<typeof orgCollectionSchema>;
export type UpdateOrganizationProfileInput = z.infer<
  typeof updateOrganizationProfileSchema
>;
export type ManualJournalInput = z.infer<typeof manualJournalSchema>;
export type JournalLineInput = z.infer<typeof journalLineSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type AgentPolicyInput = z.infer<typeof agentPolicySchema>;

export const hireAgentSchema = z.object({
  provider: z.string().min(1).max(80),
  task: z.string().min(3).max(1000),
  budgetUsd: positiveDecimal.optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});
export type HireAgentInput = z.infer<typeof hireAgentSchema>;
export type ProposeAgentPaymentInput = z.infer<typeof proposeAgentPaymentSchema>;
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

const isoDateQuery = z.iso.datetime().optional();
const listDateField = z.enum(['issueDate', 'dueDate', 'createdAt']).optional();

export const invoiceListQuerySchema = z.object({
  status: z
    .enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAYMENT_PENDING', 'PAID', 'VOID'])
    .optional(),
  vendorId: z.string().min(1).max(64).optional(),
  from: isoDateQuery,
  to: isoDateQuery,
  dateField: listDateField,
});

export const paymentListQuerySchema = z.object({
  invoiceId: z.string().min(1).max(64).optional(),
  from: isoDateQuery,
  to: isoDateQuery,
});

export const receivableListQuerySchema = z.object({
  status: z.enum(RECEIVABLE_STATUSES).optional(),
  customerId: z.string().min(1).max(64).optional(),
  currency: currencySchema.optional(),
  from: isoDateQuery,
  to: isoDateQuery,
  dateField: listDateField,
});

export const accountingQuerySchema = z.object({
  currency: currencySchema.optional(),
  from: isoDateQuery,
  to: isoDateQuery,
});

export const reportQuerySchema = z.object({
  currency: currencySchema.optional(),
  from: isoDateQuery,
  to: isoDateQuery,
});

export const documentTypeSchema = z.enum(['bill', 'invoice']);

export const createDocumentShareSchema = z.object({
  expiresInDays: z.coerce.number().int().min(1).max(365).default(30),
});

export const reportStatementSchema = z.enum([
  'cash-flow',
  'profit-and-loss',
  'balance-sheet',
  'all',
]);

export const reportExportQuerySchema = reportQuerySchema.extend({
  format: z.enum(['pdf', 'xlsx', 'csv']).default('pdf'),
  report: reportStatementSchema.default('all'),
});

export const journalQuerySchema = accountingQuerySchema.extend({
  accountCode: z.string().min(1).max(20).optional(),
  sourceType: z.enum(['invoice', 'receivable', 'receipt', 'manual', 'opening']).optional(),
  sourceId: z.string().min(1).max(64).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  // Kept for older clients; pageSize takes precedence.
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const journalExportQuerySchema = accountingQuerySchema.extend({
  accountCode: z.string().min(1).max(20).optional(),
  sourceType: z.enum(['invoice', 'receivable', 'receipt', 'manual', 'opening']).optional(),
  sourceId: z.string().min(1).max(64).optional(),
  q: z.string().trim().max(120).optional(),
  format: z.enum(['csv']).default('csv'),
});

export const agingQuerySchema = z.object({
  side: z.enum(['AP', 'AR']).default('AP'),
  currency: currencySchema.default('USD'),
});

export const trialBalanceQuerySchema = z.object({
  currency: currencySchema.optional(),
  asOf: isoDateQuery,
});

export const agentDecisionQuerySchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
});

export type ReceivableListQuery = z.infer<typeof receivableListQuerySchema>;
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;
export type AccountingQuery = z.infer<typeof accountingQuerySchema>;
export type JournalQuery = z.infer<typeof journalQuerySchema>;
export type JournalExportQuery = z.infer<typeof journalExportQuerySchema>;
export type AgingQuery = z.infer<typeof agingQuerySchema>;
export type TrialBalanceQuery = z.infer<typeof trialBalanceQuerySchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type DocumentType = z.infer<typeof documentTypeSchema>;
export type CreateDocumentShareInput = z.infer<typeof createDocumentShareSchema>;
export type ReportStatement = z.infer<typeof reportStatementSchema>;
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;

export const simulateQuerySchema = z.object({
  status: z.enum(['SUCCEEDED', 'FAILED', 'REFUNDED']).default('SUCCEEDED'),
});
