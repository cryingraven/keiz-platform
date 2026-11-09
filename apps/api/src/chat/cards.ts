import { formatUnits } from '@keiz/shared';
import type {
  AgentActionCard,
  ChatCard,
  ChatCardLink,
  ChatMoney,
  ChatPlan,
  ChatRisk,
  CustomerCardRow,
  InvoiceCardRow,
  JournalCardRow,
  PaymentCardRow,
  PaymentEventCard,
  ReceivableCardRow,
  SpendSummaryRow,
  VendorCardRow,
} from '@keiz/shared';

function iso(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function money(value: string, decimals: number, currency: string): ChatMoney {
  return {
    currency,
    decimals,
    minor: String(value ?? '0'),
    formatted: formatUnits(String(value ?? '0'), decimals),
  };
}

export function link(href: string, label: string): ChatCardLink {
  return { href, label };
}

export interface InvoiceLike {
  _id: unknown;
  number: string;
  vendorId: string;
  status: string;
  issueDate: Date | string;
  dueDate: Date | string;
  paidAt?: Date | string;
  currency: string;
  decimals: number;
  subtotal: string;
  taxAmount: string;
  total: string;
  lineItems: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
  }>;
  approvals?: Array<{
    accountId: string;
    decision: 'APPROVE' | 'REJECT';
    comment?: string;
    at: Date | string;
  }>;
  notes?: string;
}

export function invoiceRow(invoice: InvoiceLike, vendorName?: string): InvoiceCardRow {
  const id = String(invoice._id);
  return {
    id,
    number: invoice.number,
    vendorId: invoice.vendorId,
    vendorName,
    status: invoice.status,
    issueDate: iso(invoice.issueDate),
    dueDate: iso(invoice.dueDate),
    paidAt: invoice.paidAt ? iso(invoice.paidAt) : undefined,
    lineCount: invoice.lineItems?.length ?? 0,
    subtotal: money(invoice.subtotal, invoice.decimals, invoice.currency),
    tax: money(invoice.taxAmount, invoice.decimals, invoice.currency),
    total: money(invoice.total, invoice.decimals, invoice.currency),
    link: link(`/dashboard/invoices/${id}`, `View ${invoice.number}`),
  };
}

export function invoiceListCard(
  invoices: InvoiceLike[],
  vendorNames: Map<string, string>,
  filter?: string,
): ChatCard {
  return {
    kind: 'invoice-list',
    title: filter ? `Bills · ${filter}` : 'Bills',
    subtitle: `${invoices.length} invoice(s)`,
    link: link('/dashboard/invoices', 'View all bills'),
    data: {
      invoices: invoices.map((invoice) => invoiceRow(invoice, vendorNames.get(invoice.vendorId))),
      count: invoices.length,
      filter,
    },
  };
}

export function invoiceCard(
  invoice: InvoiceLike,
  vendorName: string | undefined,
  payments: PaymentRowLike[],
  invoiceNumbers: Map<string, string>,
): ChatCard {
  const row = invoiceRow(invoice, vendorName);
  return {
    kind: 'invoice',
    title: invoice.number,
    subtitle: vendorName ? `${vendorName} · ${invoice.status}` : invoice.status,
    link: link(`/dashboard/invoices/${row.id}`, 'Open invoice'),
    relatedLinks: invoice.vendorId
      ? [link(`/dashboard/vendors/${invoice.vendorId}`, 'View vendor')]
      : undefined,
    data: {
      invoice: row,
      lines: (invoice.lineItems ?? []).map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: money(line.lineTotal, invoice.decimals, invoice.currency),
      })),
      approvals: (invoice.approvals ?? []).map((approval) => ({
        accountId: approval.accountId,
        decision: approval.decision,
        comment: approval.comment,
        at: iso(approval.at),
      })),
      notes: invoice.notes,
      payments: payments.slice(0, 20).map((payment) => paymentRow(payment, invoiceNumbers)),
    },
  };
}

export function spendSummaryCard(
  rows: Array<{ _id: string; currency: string; count: number; total: string }>,
  vendorCount: number,
): ChatCard {
  const byStatus: SpendSummaryRow[] = rows.map((row) => ({
    status: row._id,
    currency: row.currency,
    count: row.count,
    total: money(row.total, 2, row.currency),
  }));
  return {
    kind: 'spend-summary',
    title: 'Spend by invoice status',
    subtitle: `${vendorCount} active vendor(s)`,
    link: link('/dashboard/invoices', 'View bills'),
    data: { byStatus, vendorCount },
  };
}

export interface BooksSummaryLike {
  currency: string;
  decimals: number;
  from: string;
  to: string;
  cash: string;
  receivable: string;
  payable: string;
  inputTax: string;
  taxPayable: string;
  revenue: string;
  expenses: string;
  netIncome: string;
  trialBalance: {
    rows: Array<{
      code: string;
      name: string;
      type: string;
      normalBalance: 'debit' | 'credit';
      debit: string;
      credit: string;
      balance: string;
    }>;
    totals: { debit: string; credit: string; balanced: boolean };
  };
}

export function booksSummaryCard(summary: BooksSummaryLike): ChatCard {
  const m = (value: string) => money(value, summary.decimals, summary.currency);
  return {
    kind: 'books-summary',
    title: `Books · ${summary.currency}`,
    subtitle: `${iso(summary.from).slice(0, 10)} → ${iso(summary.to).slice(0, 10)}`,
    link: link('/dashboard/accounting', 'Open accounting'),
    data: {
      currency: summary.currency,
      from: iso(summary.from),
      to: iso(summary.to),
      cash: m(summary.cash),
      receivable: m(summary.receivable),
      payable: m(summary.payable),
      inputTax: m(summary.inputTax),
      taxPayable: m(summary.taxPayable),
      revenue: m(summary.revenue),
      expenses: m(summary.expenses),
      netIncome: m(summary.netIncome),
      trialBalance: {
        rows: summary.trialBalance.rows.map((row) => ({
          ...row,
          debit: m(row.debit),
          credit: m(row.credit),
          balance: m(row.balance),
        })),
        totals: {
          debit: m(summary.trialBalance.totals.debit),
          credit: m(summary.trialBalance.totals.credit),
          balanced: summary.trialBalance.totals.balanced,
        },
      },
    },
  };
}

export interface VendorLike {
  _id: unknown;
  name: string;
  email: string;
  nearAccountId?: string;
  payoutChain: string;
  payoutAddress: string;
  bankName?: string;
  bankAccount?: string;
  status: string;
}

export function vendorRow(vendor: VendorLike): VendorCardRow {
  const id = String(vendor._id);
  return {
    id,
    name: vendor.name,
    email: vendor.email,
    nearAccountId: vendor.nearAccountId,
    payoutChain: vendor.payoutChain,
    payoutAddress: vendor.payoutAddress,
    bankName: vendor.bankName,
    bankAccount: vendor.bankAccount,
    status: vendor.status,
    link: link(`/dashboard/vendors/${id}`, 'View vendor'),
  };
}

export function vendorListCard(vendors: VendorLike[]): ChatCard {
  return {
    kind: 'vendor-list',
    title: 'Vendors',
    subtitle: `${vendors.length} active vendor(s)`,
    link: link('/dashboard/vendors', 'View all vendors'),
    data: { vendors: vendors.map(vendorRow) },
  };
}

export function vendorCard(vendor: VendorLike, bills: InvoiceLike[], vendorNames: Map<string, string>): ChatCard {
  return {
    kind: 'vendor',
    title: vendor.name,
    subtitle: `${vendor.payoutChain} · ${vendor.status}`,
    link: link(`/dashboard/vendors/${String(vendor._id)}`, 'Open vendor'),
    relatedLinks: [link('/dashboard/vendors', 'All vendors')],
    data: {
      vendor: vendorRow(vendor),
      bills: bills.slice(0, 20).map((bill) => invoiceRow(bill, vendorNames.get(bill.vendorId))),
    },
  };
}

export interface CustomerLike {
  _id: unknown;
  name: string;
  email: string;
  taxId?: string;
  billingAddress?: string;
  status: string;
}

export function customerRow(customer: CustomerLike): CustomerCardRow {
  const id = String(customer._id);
  return {
    id,
    name: customer.name,
    email: customer.email,
    taxId: customer.taxId,
    billingAddress: customer.billingAddress,
    status: customer.status,
    link: link(`/dashboard/customers/${id}`, 'View customer'),
  };
}

export function customerListCard(customers: CustomerLike[]): ChatCard {
  return {
    kind: 'customer-list',
    title: 'Customers',
    subtitle: `${customers.length} customer(s)`,
    link: link('/dashboard/customers', 'View all customers'),
    data: { customers: customers.map(customerRow) },
  };
}

export function customerCard(
  customer: CustomerLike,
  receivables: ReceivableLike[],
  customerNames: Map<string, string>,
): ChatCard {
  return {
    kind: 'customer',
    title: customer.name,
    subtitle: `${customer.email} · ${customer.status}`,
    link: link(`/dashboard/customers/${String(customer._id)}`, 'Open customer'),
    relatedLinks: [link('/dashboard/customers', 'All customers')],
    data: {
      customer: customerRow(customer),
      receivables: receivables
        .slice(0, 20)
        .map((receivable) => receivableRow(receivable, customerNames)),
    },
  };
}

export interface ReceivableLike {
  _id: unknown;
  number: string;
  customerId: string;
  status: string;
  issueDate: Date | string;
  dueDate: Date | string;
  currency: string;
  decimals: number;
  total: string;
  paidAmount: string;
  receipts?: Array<{
    receiptId: string;
    amount: string;
    currency: string;
    decimals: number;
    receivedAt: Date | string;
    method: string;
    reference?: string;
    txHash?: string;
  }>;
}

export function receivableRow(
  receivable: ReceivableLike,
  customerNames: Map<string, string>,
): ReceivableCardRow {
  const id = String(receivable._id);
  const outstanding = BigInt(receivable.total) - BigInt(receivable.paidAmount);
  return {
    id,
    number: receivable.number,
    customerId: receivable.customerId,
    customerName: customerNames.get(receivable.customerId),
    status: receivable.status,
    issueDate: iso(receivable.issueDate),
    dueDate: iso(receivable.dueDate),
    total: money(receivable.total, receivable.decimals, receivable.currency),
    paid: money(receivable.paidAmount, receivable.decimals, receivable.currency),
    outstanding: money(outstanding.toString(), receivable.decimals, receivable.currency),
    link: link(`/dashboard/receivables/${id}`, `View ${receivable.number}`),
  };
}

export function receivableListCard(
  receivables: ReceivableLike[],
  customerNames: Map<string, string>,
): ChatCard {
  return {
    kind: 'receivable-list',
    title: 'Customer invoices',
    subtitle: `${receivables.length} receivable(s)`,
    link: link('/dashboard/receivables', 'View all receivables'),
    data: { receivables: receivables.map((row) => receivableRow(row, customerNames)) },
  };
}

export function receivableCard(
  receivable: ReceivableLike,
  customerNames: Map<string, string>,
): ChatCard {
  const row = receivableRow(receivable, customerNames);
  return {
    kind: 'receivable',
    title: receivable.number,
    subtitle: `${row.customerName ?? 'Unknown customer'} · ${receivable.status}`,
    link: link(`/dashboard/receivables/${row.id}`, 'Open receivable'),
    relatedLinks: [link('/dashboard/receivables', 'All receivables')],
    data: {
      receivable: row,
      receipts: (receivable.receipts ?? []).map((receipt) => ({
        receiptId: receipt.receiptId,
        amount: money(receipt.amount, receipt.decimals, receipt.currency),
        receivedAt: iso(receipt.receivedAt),
        method: receipt.method,
        reference: receipt.reference,
        txHash: receipt.txHash,
      })),
    },
  };
}

export interface PaymentRowLike {
  _id: unknown;
  invoiceId?: string;
  provider: string;
  status: string;
  payer: string;
  originSymbol?: string;
  destinationSymbol?: string;
  destinationChain?: string;
  amountIn?: string;
  amountOut?: string;
  amountInFormatted?: string;
  amountOutFormatted?: string;
  originAsset?: string;
  destinationAsset?: string;
  depositAddress?: string;
  deadline?: Date | string;
  createdAt?: Date | string;
}

function symbolFromAsset(asset: string | undefined, fallback: string | undefined): string | undefined {
  if (fallback) return fallback;
  if (!asset) return undefined;
  return asset.includes(':') ? asset.split(':').pop() : asset;
}

export function paymentRow(
  payment: PaymentRowLike,
  invoiceNumbers: Map<string, string>,
): PaymentCardRow {
  const id = String(payment._id);
  return {
    id,
    invoiceId: payment.invoiceId,
    invoiceNumber: payment.invoiceId ? invoiceNumbers.get(payment.invoiceId) : undefined,
    provider: payment.provider,
    status: payment.status,
    payer: payment.payer,
    originSymbol: symbolFromAsset(payment.originAsset, payment.originSymbol),
    destinationSymbol: symbolFromAsset(payment.destinationAsset, payment.destinationSymbol),
    destinationChain: payment.destinationChain,
    amountIn: payment.amountInFormatted
      ? {
          currency: symbolFromAsset(payment.originAsset, payment.originSymbol) ?? 'TOKEN',
          decimals: 0,
          minor: payment.amountIn ?? payment.amountInFormatted,
          formatted: payment.amountInFormatted,
        }
      : undefined,
    amountOut: payment.amountOutFormatted
      ? {
          currency: symbolFromAsset(payment.destinationAsset, payment.destinationSymbol) ?? 'TOKEN',
          decimals: 0,
          minor: payment.amountOut ?? payment.amountOutFormatted,
          formatted: payment.amountOutFormatted,
        }
      : undefined,
    depositAddress: payment.depositAddress,
    deadline: payment.deadline ? iso(payment.deadline) : undefined,
    createdAt: iso(payment.createdAt),
    link: link(`/dashboard/payments/${id}`, 'View payment'),
  };
}

export function paymentListCard(payments: PaymentRowLike[], invoiceNumbers: Map<string, string>): ChatCard {
  return {
    kind: 'payment-list',
    title: 'Payments',
    subtitle: `${payments.length} payment(s)`,
    link: link('/dashboard/payments', 'View all payments'),
    data: { payments: payments.map((payment) => paymentRow(payment, invoiceNumbers)) },
  };
}

export function paymentCard(
  payment: PaymentRowLike,
  invoiceNumbers: Map<string, string>,
  events: Array<{
    _id: unknown;
    status: string;
    rawStatus?: string;
    createdAt?: Date | string;
  }>,
): ChatCard {
  const row = paymentRow(payment, invoiceNumbers);
  const eventCards: PaymentEventCard[] = events.map((event) => ({
    id: String(event._id),
    status: event.status,
    rawStatus: event.rawStatus,
    at: iso(event.createdAt),
  }));
  return {
    kind: 'payment',
    title: `Payment ${row.invoiceNumber ?? row.id.slice(-6)}`,
    subtitle: `${row.provider} · ${row.status}`,
    link: link(`/dashboard/payments/${row.id}`, 'Open payment'),
    relatedLinks: row.invoiceId
      ? [link(`/dashboard/invoices/${row.invoiceId}`, 'View invoice')]
      : undefined,
    data: { payment: row, events: eventCards },
  };
}

export interface AgentActionLike {
  _id: unknown;
  invoiceId: string;
  status: string;
  asset: string;
  amountUsd: string;
  reason?: string;
  createdAt?: Date | string;
}

export function agentActionCard(action: AgentActionLike): AgentActionCard {
  const id = String(action._id);
  return {
    id,
    invoiceId: action.invoiceId,
    status: action.status,
    asset: action.asset,
    amountUsd: action.amountUsd,
    reason: action.reason,
    createdAt: iso(action.createdAt),
    link: link(`/dashboard/invoices/${action.invoiceId}`, 'View invoice'),
  };
}

export function agentActionListCard(actions: AgentActionLike[]): ChatCard {
  return {
    kind: 'agent-action-list',
    title: 'Agent actions',
    subtitle: `${actions.length} action(s)`,
    link: link('/dashboard/agent', 'Open agent wallet'),
    data: { actions: actions.map(agentActionCard) },
  };
}

export interface JournalEntryLike {
  _id: unknown;
  date: Date | string;
  memo: string;
  sourceType: string;
  sourceId: string;
  event: string;
  currency: string;
  decimals: number;
  lines: Array<{
    accountCode: string;
    accountName?: string;
    debit: string;
    credit: string;
  }>;
}

export function journalRow(entry: JournalEntryLike): JournalCardRow {
  const id = String(entry._id);
  return {
    id,
    date: iso(entry.date),
    memo: entry.memo,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    event: entry.event,
    currency: entry.currency,
    lines: entry.lines.map((line) => ({
      accountCode: line.accountCode,
      accountName: line.accountName,
      debit: money(line.debit, entry.decimals, entry.currency),
      credit: money(line.credit, entry.decimals, entry.currency),
    })),
    link: link(`/dashboard/accounting?entry=${id}`, 'View journal'),
  };
}

export function journalListCard(entries: JournalEntryLike[]): ChatCard {
  return {
    kind: 'journal-list',
    title: 'Journal entries',
    subtitle: `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`,
    link: link('/dashboard/accounting', 'Open accounting'),
    data: { entries: entries.map(journalRow) },
  };
}

export function planCard(plan: ChatPlan): ChatCard {
  return {
    kind: 'plan',
    title: 'Action plan',
    subtitle: plan.summary,
    link: link('/dashboard/agent', 'Open agent wallet'),
    data: { plan },
  };
}

/** Mastra exposes tool object keys (camelCase); cards use kebab-case ids. */
const TOOL_ALIASES: Record<string, string> = {
  planActions: 'plan-actions',
  listInvoices: 'list-invoices',
  getInvoice: 'get-invoice',
  spendSummary: 'spend-summary',
  booksSummary: 'books-summary',
  listVendors: 'list-vendors',
  getVendor: 'get-vendor',
  listReceivables: 'list-receivables',
  getReceivable: 'get-receivable',
  listCustomers: 'list-customers',
  getCustomer: 'get-customer',
  listPayments: 'list-payments',
  getPayment: 'get-payment',
  listAgentActions: 'list-agent-actions',
  journalSummary: 'journal-summary',
  proposePayment: 'propose-payment',
};

function normalizeToolName(toolName: string): string {
  return TOOL_ALIASES[toolName] ?? toolName;
}

const RISKY_TOOLS: Record<string, ChatRisk> = {
  'propose-payment': 'spend',
  'plan-actions': 'write',
  'list-invoices': 'read',
  'get-invoice': 'read',
  'spend-summary': 'read',
  'books-summary': 'read',
  'list-vendors': 'read',
  'list-receivables': 'read',
  'get-receivable': 'read',
  'list-customers': 'read',
  'list-payments': 'read',
  'get-payment': 'read',
  'list-agent-actions': 'read',
  'journal-summary': 'read',
};

export function toolRisk(toolName: string): ChatRisk {
  return RISKY_TOOLS[normalizeToolName(toolName)] ?? 'write';
}

/** Reads run automatically after plan approval; writes and drafts need confirmation. */
export function needsConfirmation(toolName: string): boolean {
  return toolRisk(toolName) !== 'read';
}

export function describeToolCall(
  rawToolName: string,
  args: Record<string, unknown>,
): string {
  const toolName = normalizeToolName(rawToolName);
  switch (toolName) {
    case 'plan-actions':
      return `Plan: ${String(args.goal ?? 'Run a multi-step task')}`;
    case 'list-invoices':
      return args.status ? `Read ${String(args.status)} invoices` : 'Read invoices';
    case 'get-invoice':
      return `Read invoice ${String(args.number ?? '')}`.trim();
    case 'spend-summary':
      return 'Read spend totals by status';
    case 'books-summary':
      return 'Read ledger balances and the trial balance';
    case 'list-vendors':
      return 'Read the vendor list';
    case 'list-receivables':
      return args.status ? `Read ${String(args.status)} receivables` : 'Read customer invoices';
    case 'get-receivable':
      return `Read receivable ${String(args.number ?? '')}`.trim();
    case 'list-customers':
      return 'Read the customer list';
    case 'list-payments':
      return 'Read payment history';
    case 'get-payment':
      return `Read payment ${String(args.paymentId ?? '')}`.trim();
    case 'list-agent-actions':
      return 'Read agent actions';
    case 'journal-summary':
      return 'Read recent journal entries';
    case 'propose-payment':
      return `Create a payment proposal for ${String(args.invoiceNumber ?? 'an invoice')}`;
    default:
      return `Run ${rawToolName}`;
  }
}
