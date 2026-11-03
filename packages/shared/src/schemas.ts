import { z } from 'zod';
import { invoiceNumber, payoutChain, positiveDecimal, validatePayoutAddress } from './validation';

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

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  threadId: z.string().optional(),
});

export type LoginChallengeInput = z.infer<typeof loginChallengeSchema>;
export type LoginVerifyInput = z.infer<typeof loginVerifySchema>;
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type AgentPolicyInput = z.infer<typeof agentPolicySchema>;
export type ProposeAgentPaymentInput = z.infer<typeof proposeAgentPaymentSchema>;
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

export const invoiceListQuerySchema = z.object({
  status: z
    .enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAYMENT_PENDING', 'PAID', 'VOID'])
    .optional(),
});

export const paymentListQuerySchema = z.object({
  invoiceId: z.string().min(1).max(64).optional(),
});

export const agentDecisionQuerySchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
});

export const simulateQuerySchema = z.object({
  status: z.enum(['SUCCEEDED', 'FAILED', 'REFUNDED']).default('SUCCEEDED'),
});

export const passkeyRelaySchema = z.object({
  receiverId: z.string().min(2).max(64),
  methodName: z.literal('sign'),
  argsBase64: z.string().min(1).max(24_000),
  gas: z.string().regex(/^\d+$/, 'gas must be an integer string').max(20),
  deposit: z.string().regex(/^\d+$/, 'deposit must be an integer string').max(40),
});
