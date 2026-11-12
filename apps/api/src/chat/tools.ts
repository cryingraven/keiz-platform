import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  agentActionCardEnvelopeSchema,
  agentActionListCardSchema,
  agentJobCardSchema,
  agentJobListCardSchema,
  agentProviderListCardSchema,
  booksSummaryCardSchema,
  chatToolErrorSchema,
  createCustomerSchema,
  createInvoiceSchema,
  createReceivableSchema,
  createVendorSchema,
  currencySchema,
  customerCardSchema,
  customerListCardSchema,
  hireAgentSchema,
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
import { AgentJobsService } from '../agent/agent-jobs.service';
import { AgentService } from '../agent/agent.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { VendorsService } from '../vendors/vendors.service';
import {
  agentActionCard,
  agentActionListCard,
  agentJobCard,
  agentJobListCard,
  agentProviderListCard,
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
  type AgentJobLike,
  type AgentProviderLike,
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
  role: z.string().min(1),
});

type ToolContext = {
  requestContext?: { get: (key: string) => unknown };
};

/** Models sometimes send numbers for money fields; the REST schemas require strings. */
const chatLineItemSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.union([z.string(), z.number()]).transform((value) => String(value)),
  unitPrice: z.union([z.string(), z.number()]).transform((value) => String(value)),
});

const chatCurrencySchema = z
  .string()
  .transform((value) => value.toUpperCase())
  .pipe(currencySchema);

const chatTaxBpsSchema = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .pipe(z.number().int().min(0).max(10_000));

const chatDueInDaysSchema = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .pipe(z.number().int().min(1).max(365));

function requireOrg(context: ToolContext | undefined): string {
  const orgId = context?.requestContext?.get('orgId');
  if (typeof orgId !== 'string' || !orgId) {
    throw new Error('Missing orgId in request context - refusing to query tenant data');
  }
  return orgId;
}

function requireUser(context: ToolContext | undefined): string {
  const userId = context?.requestContext?.get('userId');
  if (typeof userId !== 'string' || !userId) {
    throw new Error('Missing userId in request context - refusing to write tenant data');
  }
  return userId;
}

function isAdmin(context: ToolContext | undefined): boolean {
  const role = context?.requestContext?.get('role');
  return role === 'ADMIN' || role === 'OWNER';
}

function zodMessage(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function isoDate(value: string): string {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error('Dates must be ISO strings or YYYY-MM-DD');
  return date.toISOString();
}

function dueDateFrom(input: { dueDate?: string; dueInDays?: number }): string {
  if (input.dueDate) return isoDate(input.dueDate);
  const days = input.dueInDays ?? 14;
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

async function resolveVendor(
  orgId: string,
  query: string,
  vendors: VendorsService,
): Promise<VendorLike> {
  const rows = (await vendors.list(orgId)) as VendorLike[];
  const needle = query.trim().toLowerCase();
  const exact = rows.filter(
    (vendor) =>
      vendor.name.toLowerCase() === needle ||
      vendor.email.toLowerCase() === needle ||
      vendor.nearAccountId?.toLowerCase() === needle,
  );
  const matches = exact.length
    ? exact
    : rows.filter(
        (vendor) =>
          vendor.name.toLowerCase().includes(needle) ||
          vendor.email.toLowerCase().includes(needle),
      );
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(
      `Vendor "${query}" was not found in this workspace. Create the vendor first or use the exact name or email.`,
    );
  }
  throw new Error(
    `Vendor "${query}" is ambiguous: ${matches
      .slice(0, 5)
      .map((vendor) => vendor.name)
      .join(', ')}. Ask for the exact name or email.`,
  );
}

async function resolveCustomer(
  orgId: string,
  query: string,
  receivables: ReceivablesService,
): Promise<CustomerLike> {
  const rows = (await receivables.listCustomers(orgId)) as CustomerLike[];
  const needle = query.trim().toLowerCase();
  const exact = rows.filter(
    (customer) =>
      customer.name.toLowerCase() === needle || customer.email.toLowerCase() === needle,
  );
  const matches = exact.length
    ? exact
    : rows.filter(
        (customer) =>
          customer.name.toLowerCase().includes(needle) ||
          customer.email.toLowerCase().includes(needle),
      );
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(
      `Customer "${query}" was not found in this workspace. Create the customer first or use the exact name or email.`,
    );
  }
  throw new Error(
    `Customer "${query}" is ambiguous: ${matches
      .slice(0, 5)
      .map((customer) => customer.name)
      .join(', ')}. Ask for the exact name or email.`,
  );
}

/** Reject the approval prompt unless the plan has already been approved. */
function requirePlan(
  _input: unknown,
  ctx?: { requestContext?: unknown },
): { proceed: false; output: { error: string } } | undefined {
  const requestContext = ctx?.requestContext as
    | { get?: (key: string) => unknown; planApproved?: unknown }
    | undefined;
  const approved =
    typeof requestContext?.get === 'function'
      ? requestContext.get('planApproved') === true
      : requestContext?.planApproved === true;
  if (!approved) {
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
  jobs: AgentJobsService;
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
    description: 'Get one bill by its document number, for example BIL-26/11/00001.',
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
    description: 'Get one customer invoice by its document number, for example INV-26/11/0001.',
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
      sourceType: z
        .enum(['invoice', 'receivable', 'receipt', 'manual', 'opening', 'expense', 'revenue'])
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: journalListCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async (input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const journal = await deps.accounting.journal(orgId, {
        ...input,
        limit: input.limit ?? 20,
      });
      return journalListCard(journal.items as JournalEntryLike[]);
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

  const createVendor = createTool({
    id: 'create-vendor',
    description:
      'Create a vendor (payee) in the current organization. Requires ADMIN or OWNER. Use only after the user has supplied the name, email, payout chain and payout address. This does not pay anyone.',
    inputSchema: z.object({
      name: z.string().min(1).max(120),
      email: z.string().min(3).max(200),
      nearAccountId: z.string().max(64).optional(),
      payoutChain: z.string().min(2).max(20).optional(),
      payoutAddress: z.string().min(2).max(200),
      bankName: z.string().max(120).optional(),
      bankAccount: z.string().max(60).optional(),
    }),
    outputSchema: vendorCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    requireApproval: true,
    beforeApproval: requirePlan,
    execute: async (input, context) => {
      const orgId = requireOrg(context as ToolContext);
      if (!isAdmin(context as ToolContext)) {
        return { error: 'Only an ADMIN or OWNER can create vendors.' };
      }
      const parsed = createVendorSchema.safeParse(input);
      if (!parsed.success) return { error: zodMessage(parsed.error) };
      const existing = (await deps.vendors.list(orgId)) as VendorLike[];
      const duplicate = existing.find(
        (vendor) => vendor.email.toLowerCase() === parsed.data.email.toLowerCase(),
      );
      if (duplicate) {
        return {
          error: `A vendor with email ${parsed.data.email} already exists (${duplicate.name}).`,
        };
      }
      const vendor = (await deps.vendors.create(orgId, parsed.data)) as unknown as VendorLike;
      return {
        ...vendorCard(vendor, [], new Map()),
        title: `Created ${vendor.name}`,
        subtitle: `New vendor · ${vendor.payoutChain} · ${vendor.status}`,
      };
    },
  });

  const createCustomer = createTool({
    id: 'create-customer',
    description:
      'Create a customer in the current organization. Use only after the user has supplied the name and email. This does not issue an invoice.',
    inputSchema: z.object({
      name: z.string().min(1).max(120),
      email: z.string().min(3).max(200),
      taxId: z.string().max(60).optional(),
      billingAddress: z.string().max(300).optional(),
    }),
    outputSchema: customerCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    requireApproval: true,
    beforeApproval: requirePlan,
    execute: async (input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const parsed = createCustomerSchema.safeParse(input);
      if (!parsed.success) return { error: zodMessage(parsed.error) };
      const existing = (await deps.receivables.listCustomers(orgId)) as CustomerLike[];
      const duplicate = existing.find(
        (customer) => customer.email.toLowerCase() === parsed.data.email.toLowerCase(),
      );
      if (duplicate) {
        return {
          error: `A customer with email ${parsed.data.email} already exists (${duplicate.name}).`,
        };
      }
      const customer = (await deps.receivables.createCustomer(
        orgId,
        parsed.data,
      )) as unknown as CustomerLike;
      return {
        ...customerCard(customer, [], new Map()),
        title: `Created ${customer.name}`,
        subtitle: `New customer · ${customer.email} · ${customer.status}`,
      };
    },
  });

  const createBill = createTool({
    id: 'create-bill',
    description:
      'Create an AP bill (vendor invoice) for an existing vendor. Resolve the vendor by name or email; never invent a vendor id. The API assigns the BIL-YY/MM/XXXXX number. Creates a DRAFT and, only when the user explicitly asks, submits it. Submitting does not post to the ledger.',
    inputSchema: z.object({
      vendor: z.string().min(1).max(200),
      issueDate: z.string().min(1).max(40).optional(),
      dueDate: z.string().min(1).max(40).optional(),
      dueInDays: chatDueInDaysSchema.optional(),
      currency: chatCurrencySchema.default('USD'),
      taxBps: chatTaxBpsSchema.default(0),
      notes: z.string().max(2000).optional(),
      lineItems: z.array(chatLineItemSchema).min(1).max(50),
      submit: z.boolean().optional(),
    }),
    outputSchema: invoiceCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    requireApproval: true,
    beforeApproval: requirePlan,
    execute: async (input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const userId = requireUser(context as ToolContext);
      let vendor: VendorLike;
      try {
        vendor = await resolveVendor(orgId, input.vendor, deps.vendors);
      } catch (error) {
        return { error: (error as Error).message };
      }
      let dueDate: string;
      let issueDate: string | undefined;
      try {
        dueDate = dueDateFrom(input);
        issueDate = input.issueDate ? isoDate(input.issueDate) : undefined;
      } catch (error) {
        return { error: (error as Error).message };
      }
      const parsed = createInvoiceSchema.safeParse({
        vendorId: String(vendor._id),
        issueDate,
        dueDate,
        currency: input.currency,
        taxBps: input.taxBps,
        notes: input.notes,
        lineItems: input.lineItems,
      });
      if (!parsed.success) return { error: zodMessage(parsed.error) };

      let invoice: InvoiceLike;
      try {
        invoice = (await deps.invoices.create(
          orgId,
          userId,
          parsed.data,
        )) as unknown as InvoiceLike;
      } catch (error) {
        return { error: (error as Error).message };
      }

      let warning: string | undefined;
      if (input.submit) {
        try {
          invoice = (await deps.invoices.submit(
            orgId,
            String(invoice._id),
          )) as unknown as InvoiceLike;
        } catch (error) {
          warning = `Created as DRAFT; submit failed: ${shortError(error)}`;
        }
      }

      return {
        ...invoiceCard(invoice, vendor.name, [], new Map([[String(invoice._id), invoice.number]])),
        title: `Created ${invoice.number}`,
        subtitle: `New AP bill · ${invoice.status}${warning ? ` · ${warning}` : ''}`,
        relatedLinks: [
          { href: '/dashboard/invoices', label: 'View all bills' },
          { href: `/dashboard/vendors/${String(vendor._id)}`, label: 'View vendor' },
        ],
      };
    },
  });

  const createReceivable = createTool({
    id: 'create-receivable',
    description:
      'Create an AR customer invoice (receivable) for an existing customer. Resolve the customer by name or email; never invent a customer id. The API assigns the INV-YY/MM/XXXX number. Creates a DRAFT and, only when the user explicitly asks, issues it. Issuing posts AR to the ledger.',
    inputSchema: z.object({
      customer: z.string().min(1).max(200),
      issueDate: z.string().min(1).max(40).optional(),
      dueDate: z.string().min(1).max(40).optional(),
      dueInDays: chatDueInDaysSchema.optional(),
      currency: chatCurrencySchema.default('USD'),
      taxBps: chatTaxBpsSchema.default(0),
      notes: z.string().max(2000).optional(),
      lineItems: z.array(chatLineItemSchema).min(1).max(50),
      issue: z.boolean().optional(),
    }),
    outputSchema: receivableCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    requireApproval: true,
    beforeApproval: requirePlan,
    execute: async (input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const userId = requireUser(context as ToolContext);
      let customer: CustomerLike;
      try {
        customer = await resolveCustomer(orgId, input.customer, deps.receivables);
      } catch (error) {
        return { error: (error as Error).message };
      }
      let dueDate: string;
      let issueDate: string | undefined;
      try {
        dueDate = dueDateFrom(input);
        issueDate = input.issueDate ? isoDate(input.issueDate) : undefined;
      } catch (error) {
        return { error: (error as Error).message };
      }
      const parsed = createReceivableSchema.safeParse({
        customerId: String(customer._id),
        issueDate,
        dueDate,
        currency: input.currency,
        taxBps: input.taxBps,
        notes: input.notes,
        lineItems: input.lineItems,
      });
      if (!parsed.success) return { error: zodMessage(parsed.error) };

      let receivable: ReceivableLike;
      try {
        receivable = (await deps.receivables.create(
          orgId,
          userId,
          parsed.data,
        )) as unknown as ReceivableLike;
      } catch (error) {
        return { error: (error as Error).message };
      }

      let warning: string | undefined;
      if (input.issue) {
        try {
          receivable = (await deps.receivables.issue(
            orgId,
            String(receivable._id),
          )) as unknown as ReceivableLike;
        } catch (error) {
          warning = `Created as DRAFT; issue failed: ${shortError(error)}`;
        }
      }

      const names = new Map([[String(customer._id), customer.name]]);
      return {
        ...receivableCard(receivable, names),
        title: `Created ${receivable.number}`,
        subtitle: `New AR invoice · ${receivable.status}${warning ? ` · ${warning}` : ''}`,
        relatedLinks: [
          { href: '/dashboard/receivables', label: 'View all receivables' },
          { href: `/dashboard/customers/${String(customer._id)}`, label: 'View customer' },
        ],
      };
    },
  });

  const listAgentProviders = createTool({
    id: 'list-agent-providers',
    description:
      'List specialist agents available to hire, their capability and price. Use before hiring.',
    inputSchema: z.object({}),
    outputSchema: agentProviderListCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async (_input, context) => {
      requireOrg(context as ToolContext);
      const rows = (await deps.jobs.listProviders()) as unknown as AgentProviderLike[];
      return agentProviderListCard(rows);
    },
  });

  const hireAgent = createTool({
    id: 'hire-agent',
    description:
      'Hire a specialist agent for a bounded task. Requires ADMIN or OWNER. The provider and price come from the provider registry; never invent them. Spends the workspace agent budget and returns a job with the provider result.',
    inputSchema: hireAgentSchema,
    outputSchema: agentJobCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    requireApproval: true,
    beforeApproval: requirePlan,
    execute: async (input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const userId = requireUser(context as ToolContext);
      if (!isAdmin(context as ToolContext)) {
        return { error: 'Only an ADMIN or OWNER can hire agents.' };
      }
      try {
        const job = await deps.jobs.hire(orgId, userId, input, {
          approvalGranted: true,
          executeNow: true,
        });
        return agentJobCard(job as unknown as AgentJobLike);
      } catch (error) {
        return { error: (error as Error).message };
      }
    },
  });

  const listAgentJobs = createTool({
    id: 'list-agent-jobs',
    description: 'List recent agent hires with provider, cost, status and result summary.',
    inputSchema: z.object({}),
    outputSchema: agentJobListCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    execute: async (_input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = (await deps.jobs.listJobs(orgId)) as unknown as AgentJobLike[];
      return agentJobListCard(rows);
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
    createVendor,
    createCustomer,
    createBill,
    createReceivable,
    listAgentProviders,
    hireAgent,
    listAgentJobs,
  };
}

export type ChatTools = ReturnType<typeof createChatTools>;
