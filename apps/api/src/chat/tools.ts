import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  agentActionCardEnvelopeSchema,
  agentActionListCardSchema,
  booksSummaryCardSchema,
  chatToolErrorSchema,
  customerCardSchema,
  customerListCardSchema,
  invoiceCardSchema,
  invoiceListCardSchema,
  journalListCardSchema,
  paymentCardSchema,
  paymentListCardSchema,
  receivableCardSchema,
  receivableListCardSchema,
  spendSummaryCardSchema,
  vendorCardSchema,
  vendorListCardSchema,
} from '@keiz/shared';
import { AccountingService } from '../accounting/accounting.service';
import { AgentService } from '../agent/agent.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { VendorsService } from '../vendors/vendors.service';
import {
  agentActionCard,
  agentActionListCard,
  booksSummaryCard,
  customerCard,
  customerListCard,
  describeToolCall,
  invoiceCard,
  invoiceListCard,
  journalListCard,
  paymentCard,
  paymentListCard,
  receivableCard,
  receivableListCard,
  spendSummaryCard,
  vendorCard,
  vendorListCard,
  type AgentActionLike,
  type CustomerLike,
  type InvoiceLike,
  type JournalEntryLike,
  type PaymentRowLike,
  type ReceivableLike,
  type VendorLike,
} from './cards';
import { createPlanTool } from './plan';

const requestContextSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  accountId: z.string().min(1),
});

type ToolContext = {
  requestContext?: { get: (key: string) => unknown };
};

function requireOrg(context: ToolContext | undefined): string {
  const orgId = context?.requestContext?.get('orgId');
  if (typeof orgId !== 'string' || !orgId) {
    throw new Error('Missing orgId in request context - refusing to query tenant data');
  }
  return orgId;
}

/** Reject the approval prompt unless the plan has already been approved. */
function requirePlan(
  _input: unknown,
  ctx?: { requestContext?: Record<string, unknown> },
): { proceed: false; output: { error: string } } | undefined {
  if (ctx?.requestContext?.planApproved !== true) {
    return {
      proceed: false as const,
      output: {
        error:
          'Blocked: call plan-actions and get the plan approved before calling any other tool.',
      },
    };
  }
  return undefined;
}

async function invoiceVendorNames(
  orgId: string,
  vendors: VendorsService,
): Promise<Map<string, string>> {
  const rows = (await vendors.list(orgId)) as VendorLike[];
  return new Map(rows.map((vendor) => [String(vendor._id), vendor.name]));
}

async function invoiceNumbers(
  orgId: string,
  invoices: InvoicesService,
): Promise<Map<string, string>> {
  const rows = (await invoices.list(orgId, {})) as InvoiceLike[];
  return new Map(rows.map((invoice) => [String(invoice._id), invoice.number]));
}

export interface ChatToolDeps {
  invoices: InvoicesService;
  vendors: VendorsService;
  payments: PaymentsService;
  agent: AgentService;
  accounting: AccountingService;
  receivables: ReceivablesService;
}

/**
 * Tools are created once, but every query is scoped by the orgId that Nest puts
 * into the per-request Mastra RequestContext. The model never sees or chooses it.
 * Every tool returns a detailed ChatCard envelope consumed by the custom UI.
 */
export function createChatTools(deps: ChatToolDeps) {
  const listInvoices = createTool({
    id: 'list-invoices',
    description:
      'List bills (AP) for the current organization, optionally filtered by status. Use before stating any invoice fact.',
    inputSchema: z.object({
      status: z
        .enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAYMENT_PENDING', 'PAID', 'VOID'])
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: invoiceListCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async ({ status, limit }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const [rows, names] = await Promise.all([
        deps.invoices.list(orgId, { status }) as Promise<InvoiceLike[]>,
        invoiceVendorNames(orgId, deps.vendors),
      ]);
      const sliced = rows.slice(0, limit ?? 20);
      return invoiceListCard(sliced, names, status);
    },
  });

  const getInvoice = createTool({
    id: 'get-invoice',
    description: 'Get one bill by its invoice number, for example INV-1042.',
    inputSchema: z.object({ number: z.string().min(1) }),
    outputSchema: invoiceCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async ({ number }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = (await deps.invoices.list(orgId, {})) as InvoiceLike[];
      const invoice = rows.find((row) => row.number.toLowerCase() === number.toLowerCase());
      if (!invoice) return { error: `Invoice ${number} not found` };
      const [vendor, payments, numbers] = await Promise.all([
        deps.vendors.findOne(orgId, invoice.vendorId).catch(() => null) as Promise<
          VendorLike | null
        >,
        deps.payments.list(orgId, { invoiceId: String(invoice._id) }) as Promise<PaymentRowLike[]>,
        invoiceNumbers(orgId, deps.invoices),
      ]);
      return invoiceCard(invoice, vendor?.name, payments, numbers);
    },
  });

  const spendSummary = createTool({
    id: 'spend-summary',
    description:
      'Totals grouped by invoice status plus the vendor count. Use for spend, burn or pipeline questions.',
    inputSchema: z.object({}),
    outputSchema: spendSummaryCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async (_input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const [byStatus, vendorRows] = await Promise.all([
        deps.invoices.summary(orgId),
        deps.vendors.list(orgId),
      ]);
      return spendSummaryCard(byStatus, vendorRows.length);
    },
  });

  const booksSummary = createTool({
    id: 'books-summary',
    description:
      'Cash, accounts receivable, accounts payable, revenue, expenses and net income from the double-entry ledger for the current month. Use for books, cash or balance questions.',
    inputSchema: z.object({}),
    outputSchema: booksSummaryCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async (_input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const summary = await deps.accounting.summary(orgId, {});
      return booksSummaryCard(summary);
    },
  });

  const listVendors = createTool({
    id: 'list-vendors',
    description: 'List active vendors with their payout chain and address.',
    inputSchema: z.object({}),
    outputSchema: vendorListCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async (_input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = (await deps.vendors.list(orgId)) as VendorLike[];
      return vendorListCard(rows);
    },
  });

  const getVendor = createTool({
    id: 'get-vendor',
    description: 'Get one vendor by name or NEAR account id.',
    inputSchema: z.object({ query: z.string().min(1) }),
    outputSchema: vendorCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async ({ query }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = (await deps.vendors.list(orgId)) as VendorLike[];
      const needle = query.toLowerCase();
      const vendor = rows.find(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          row.email.toLowerCase() === needle ||
          row.nearAccountId?.toLowerCase() === needle,
      );
      if (!vendor) return { error: `Vendor ${query} not found` };
      const [bills, names] = await Promise.all([
        deps.invoices.list(orgId, {}) as Promise<InvoiceLike[]>,
        invoiceVendorNames(orgId, deps.vendors),
      ]);
      return vendorCard(
        vendor,
        bills.filter((bill) => bill.vendorId === String(vendor._id)),
        names,
      );
    },
  });

  const listReceivables = createTool({
    id: 'list-receivables',
    description: 'List customer invoices (AR), optionally filtered by status, customer or currency.',
    inputSchema: z.object({
      status: z.enum(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID']).optional(),
      customerId: z.string().min(1).optional(),
      currency: z.enum(['USD', 'EUR', 'SGD', 'IDR']).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: receivableListCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async (input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const [rows, customers] = await Promise.all([
        deps.receivables.list(orgId, input) as Promise<ReceivableLike[]>,
        deps.receivables.listCustomers(orgId) as Promise<CustomerLike[]>,
      ]);
      const names = new Map(customers.map((customer) => [String(customer._id), customer.name]));
      return receivableListCard(rows.slice(0, input.limit ?? 20), names);
    },
  });

  const getReceivable = createTool({
    id: 'get-receivable',
    description: 'Get one customer invoice by its receivable number, for example AR-2001.',
    inputSchema: z.object({ number: z.string().min(1) }),
    outputSchema: receivableCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async ({ number }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const receivable = (await deps.receivables.findByNumber(orgId, number)) as
        | ReceivableLike
        | null;
      if (!receivable) return { error: `Receivable ${number} not found` };
      const customers = (await deps.receivables.listCustomers(orgId)) as CustomerLike[];
      const names = new Map(customers.map((customer) => [String(customer._id), customer.name]));
      return receivableCard(receivable, names);
    },
  });

  const listCustomers = createTool({
    id: 'list-customers',
    description: 'List active customers with contact details.',
    inputSchema: z.object({ query: z.string().max(120).optional() }),
    outputSchema: customerListCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async ({ query }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = (await deps.receivables.listCustomers(orgId, { query })) as CustomerLike[];
      return customerListCard(rows);
    },
  });

  const getCustomer = createTool({
    id: 'get-customer',
    description: 'Get one customer by name or email, including their receivables.',
    inputSchema: z.object({ query: z.string().min(1) }),
    outputSchema: customerCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async ({ query }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const customers = (await deps.receivables.listCustomers(orgId, { query })) as CustomerLike[];
      const customer = customers[0];
      if (!customer) return { error: `Customer ${query} not found` };
      const [receivables, allCustomers] = await Promise.all([
        deps.receivables.list(orgId, { customerId: String(customer._id) }) as Promise<
          ReceivableLike[]
        >,
        deps.receivables.listCustomers(orgId) as Promise<CustomerLike[]>,
      ]);
      const names = new Map(allCustomers.map((row) => [String(row._id), row.name]));
      return customerCard(customer, receivables, names);
    },
  });

  const listPayments = createTool({
    id: 'list-payments',
    description: 'List payment quotes and settlements, optionally for one invoice.',
    inputSchema: z.object({
      invoiceId: z.string().min(1).optional(),
      status: z.string().min(1).max(40).optional(),
    }),
    outputSchema: paymentListCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async ({ invoiceId, status }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const [rows, numbers] = await Promise.all([
        deps.payments.list(orgId, { invoiceId }) as Promise<PaymentRowLike[]>,
        invoiceNumbers(orgId, deps.invoices),
      ]);
      const filtered = status ? rows.filter((row) => row.status === status) : rows;
      return paymentListCard(filtered.slice(0, 30), numbers);
    },
  });

  const getPayment = createTool({
    id: 'get-payment',
    description: 'Get one payment and its event timeline by payment id.',
    inputSchema: z.object({ paymentId: z.string().min(1) }),
    outputSchema: paymentCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async ({ paymentId }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const payment = (await deps.payments.findOne(orgId, paymentId)) as PaymentRowLike;
      const [events, numbers] = await Promise.all([
        deps.payments.eventsFor(orgId, paymentId),
        invoiceNumbers(orgId, deps.invoices),
      ]);
      return paymentCard(payment, numbers, events);
    },
  });

  const listAgentActions = createTool({
    id: 'list-agent-actions',
    description: 'List recent agent payment proposals and their status.',
    inputSchema: z.object({}),
    outputSchema: agentActionListCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async (_input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = (await deps.agent.listActions(orgId)) as AgentActionLike[];
      return agentActionListCard(rows);
    },
  });

  const journalSummary = createTool({
    id: 'journal-summary',
    description:
      'List recent journal entries with debit/credit lines. Use for ledgers, postings and audit questions.',
    inputSchema: z.object({
      currency: z.enum(['USD', 'EUR', 'SGD', 'IDR']).optional(),
      sourceType: z.enum(['invoice', 'receivable', 'receipt', 'manual', 'opening']).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: journalListCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async (input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = (await deps.accounting.journal(orgId, {
        ...input,
        limit: input.limit ?? 20,
      })) as JournalEntryLike[];
      return journalListCard(rows);
    },
  });

  const proposePayment = createTool({
    id: 'propose-payment',
    description:
      'Create an agent payment proposal for an APPROVED invoice. This never moves funds; it only queues an action for a human to approve or execute.',
    inputSchema: z.object({
      invoiceNumber: z.string().min(1),
      reason: z.string().max(1000).optional(),
    }),
    outputSchema: agentActionCardEnvelopeSchema.or(chatToolErrorSchema),
    requestContextSchema,
    requireApproval: true,
    beforeApproval: requirePlan,
    execute: async ({ invoiceNumber, reason }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = (await deps.invoices.list(orgId, {})) as InvoiceLike[];
      const invoice = rows.find(
        (row) => row.number.toLowerCase() === invoiceNumber.toLowerCase(),
      );
      if (!invoice) return { error: `Invoice ${invoiceNumber} not found` };
      if (invoice.status !== 'APPROVED') {
        return { error: `Invoice is ${invoice.status}; only APPROVED invoices can be proposed` };
      }
      const tokens = await deps.payments.tokens();
      const asset = tokens.find(
        (token) => token.symbol === 'USDC' && token.blockchain === 'near',
      );
      if (!asset) return { error: 'USDC on NEAR is unavailable in the token list' };

      const action = await deps.agent.propose(orgId, {
        invoiceId: String(invoice._id),
        asset: asset.assetId,
        reason: reason ?? `Proposed from chat (${describeToolCall('propose-payment', { invoiceNumber })})`,
      });
      return {
        kind: 'agent-action',
        title: `Proposal · ${invoice.number}`,
        subtitle: `${action.status} · ${invoice.currency} ${action.amountUsd}`,
        link: { href: `/dashboard/invoices/${String(invoice._id)}`, label: 'View invoice' },
        relatedLinks: [{ href: '/dashboard/agent', label: 'Open agent wallet' }],
        data: {
          action: agentActionCard({
            _id: action._id,
            invoiceId: String(invoice._id),
            status: action.status,
            asset: action.asset,
            amountUsd: action.amountUsd,
            reason: action.reason,
            createdAt: new Date(),
          }),
        },
      };
    },
  });

  const planActions = createPlanTool();

  return {
    'plan-actions': planActions,
    listInvoices,
    getInvoice,
    spendSummary,
    booksSummary,
    listVendors,
    getVendor,
    listReceivables,
    getReceivable,
    listCustomers,
    getCustomer,
    listPayments,
    getPayment,
    listAgentActions,
    journalSummary,
    proposePayment,
  };
}

export type ChatTools = ReturnType<typeof createChatTools>;
