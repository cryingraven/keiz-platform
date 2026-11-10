import { formatUnits } from '@keiz/shared';
import { InvoicesService } from '../invoices/invoices.service';
import { ReceivablesService } from '../receivables/receivables.service';

export interface AgentProviderHandlerContext {
  orgId: string;
  input: Record<string, unknown>;
  invoices: InvoicesService;
  receivables: ReceivablesService;
}

export interface AgentProviderResult {
  summary: string;
  data: Record<string, unknown>;
}

export type AgentProviderHandler = (
  context: AgentProviderHandlerContext,
) => Promise<AgentProviderResult>;

export const DEFAULT_AGENT_PROVIDERS = [
  {
    slug: 'tax-reviewer',
    name: 'Tax Reviewer',
    description: 'Recomputes invoice totals and flags tax or line-item mismatches.',
    capability: 'tax-review',
    priceUsd: '1.00',
    asset: 'nep141:usdc.near',
    accountId: 'tax-reviewer.near',
    mode: 'local' as const,
    active: true,
  },
  {
    slug: 'collections-writer',
    name: 'Collections Writer',
    description: 'Drafts a polite customer follow-up for an overdue receivable.',
    capability: 'collections-draft',
    priceUsd: '0.50',
    asset: 'nep141:usdc.near',
    accountId: 'collections-writer.near',
    mode: 'local' as const,
    active: true,
  },
  {
    slug: 'receipt-matcher',
    name: 'Reconciliation Agent',
    description: 'Matches recorded receipts against a customer invoice and reports the gap.',
    capability: 'receipt-match',
    priceUsd: '0.75',
    asset: 'nep141:usdc.near',
    accountId: 'reconciler.near',
    mode: 'local' as const,
    active: true,
  },
];

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`input.${key} is required`);
  }
  return value.trim();
}

async function taxReview({
  orgId,
  input,
  invoices,
}: AgentProviderHandlerContext): Promise<AgentProviderResult> {
  const number = requiredString(input, 'invoiceNumber');
  const rows = await invoices.list(orgId, {});
  const invoice = rows.find((row) => row.number.toLowerCase() === number.toLowerCase());
  if (!invoice) throw new Error(`Invoice ${number} was not found`);

  const expectedSubtotal = BigInt(invoice.subtotal);
  const expectedTax = BigInt(invoice.taxAmount);
  const expectedTotal = BigInt(invoice.total);
  const issues: string[] = [];
  if (expectedSubtotal + expectedTax !== expectedTotal) {
    issues.push('Stored subtotal + tax does not equal the stored total');
  }
  if (expectedTotal === 0n) issues.push('Invoice total is zero');
  if (invoice.lineItems.length === 0) issues.push('Invoice has no line items');

  const money = (value: bigint) => formatUnits(value, invoice.decimals);
  return {
    summary:
      issues.length === 0
        ? `Tax review for ${invoice.number}: no issues (subtotal ${money(expectedSubtotal)}, tax ${money(expectedTax)}, total ${money(expectedTotal)}).`
        : `Tax review for ${invoice.number}: ${issues.length} issue(s). ${issues.join('; ')}`,
    data: {
      invoiceNumber: invoice.number,
      invoiceStatus: invoice.status,
      currency: invoice.currency,
      subtotal: money(expectedSubtotal),
      tax: money(expectedTax),
      total: money(expectedTotal),
      issues,
    },
  };
}

async function collectionsDraft({
  orgId,
  input,
  receivables,
}: AgentProviderHandlerContext): Promise<AgentProviderResult> {
  const number = requiredString(input, 'receivableNumber');
  const receivable = await receivables.findByNumber(orgId, number);
  if (!receivable) throw new Error(`Receivable ${number} was not found`);
  const customers = await receivables.listCustomers(orgId);
  const customer = customers.find((row) => String(row._id) === receivable.customerId);
  const outstanding = BigInt(receivable.total) - BigInt(receivable.paidAmount);
  const amount = formatUnits(outstanding, receivable.decimals);
  const due = new Date(receivable.dueDate).toISOString().slice(0, 10);
  const subject = `Payment reminder for ${receivable.number}`;
  const body = [
    `Hi ${customer?.name ?? 'there'},`,
    '',
    `Our records show ${receivable.currency} ${amount} is outstanding on ${receivable.number}, due ${due}.`,
    'Could you confirm the payment date or share the transfer reference?',
    '',
    'Thank you,',
  ].join('\n');
  return {
    summary: `Drafted a collections follow-up for ${receivable.number} (${receivable.currency} ${amount} outstanding).`,
    data: { receivableNumber: receivable.number, outstanding: amount, currency: receivable.currency, subject, body },
  };
}

async function receiptMatch({
  orgId,
  input,
  receivables,
}: AgentProviderHandlerContext): Promise<AgentProviderResult> {
  const number = requiredString(input, 'receivableNumber');
  const receivable = await receivables.findByNumber(orgId, number);
  if (!receivable) throw new Error(`Receivable ${number} was not found`);
  const receipts = receivable.receipts ?? [];
  const recorded = receipts.reduce((sum, receipt) => sum + BigInt(receipt.amount), 0n);
  const paid = BigInt(receivable.paidAmount);
  const total = BigInt(receivable.total);
  const outstanding = total - paid;
  const issues: string[] = [];
  if (recorded !== paid) issues.push('Recorded receipts do not equal paidAmount');
  if (paid > total) issues.push('Paid amount exceeds the invoice total');
  return {
    summary:
      issues.length === 0
        ? `Receipts for ${receivable.number} reconcile: ${receipts.length} receipt(s), ${formatUnits(paid, receivable.decimals)} paid, ${formatUnits(outstanding, receivable.decimals)} outstanding.`
        : `Receipt review for ${receivable.number}: ${issues.join('; ')}`,
    data: {
      receivableNumber: receivable.number,
      receiptCount: receipts.length,
      paid: formatUnits(paid, receivable.decimals),
      outstanding: formatUnits(outstanding, receivable.decimals),
      currency: receivable.currency,
      issues,
    },
  };
}

export const AGENT_PROVIDER_HANDLERS: Record<string, AgentProviderHandler> = {
  'tax-review': taxReview,
  'collections-draft': collectionsDraft,
  'receipt-match': receiptMatch,
};
