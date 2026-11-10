'use client';

import { Building2, Contact, FileText, Receipt } from 'lucide-react';
import {
  CURRENCY_DECIMALS,
  computeInvoiceTotals,
  formatUnits,
  validatePayoutAddress,
} from '@keiz/shared';
import { Badge } from '@/components/ui';
import { formatDate, humanize } from '@/lib/format';

const CREATE_TOOLS = new Set([
  'create-vendor',
  'create-customer',
  'create-bill',
  'create-receivable',
]);

function canonical(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function isCreateTool(name: string): boolean {
  return CREATE_TOOLS.has(canonical(name));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function positiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

function lineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      description: text(row.description),
      quantity: text(row.quantity) || '1',
      unitPrice: text(row.unitPrice),
    };
  });
}

function invoicePreview(args: Record<string, unknown>) {
  const currency = text(args.currency) || 'USD';
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const taxBps = typeof args.taxBps === 'number' ? args.taxBps : 0;
  const lines = lineItems(args.lineItems);
  let totals: ReturnType<typeof computeInvoiceTotals> | null = null;
  try {
    totals = computeInvoiceTotals(lines, decimals, taxBps);
  } catch {
    totals = null;
  }
  const due = text(args.dueDate)
    ? formatDate(text(args.dueDate))
    : `Net ${positiveNumber(args.dueInDays) || 14} days`;
  return { currency, decimals, taxBps, lines, totals, due };
}

function money(value: string | undefined, decimals: number, currency: string): string {
  if (value === undefined) return '—';
  return `${currency} ${formatUnits(value, decimals)}`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-paper px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <div className="mt-0.5 truncate font-num text-[12px] font-medium">{value || '—'}</div>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'draft' | 'ledger'; children: React.ReactNode }) {
  return (
    <p
      className={
        tone === 'ledger'
          ? 'mt-2 rounded-lg bg-amber-soft px-2.5 py-2 text-[11px] leading-relaxed text-amber'
          : 'mt-2 rounded-lg bg-paper px-2.5 py-2 text-[11px] leading-relaxed text-muted'
      }
    >
      {children}
    </p>
  );
}

function VendorPreview({ args }: { args: Record<string, unknown> }) {
  const chain = text(args.payoutChain) || 'near';
  const address = text(args.payoutAddress);
  const addressError = address ? validatePayoutAddress(chain, address) : 'Payout address is required';
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand">
          <Building2 className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{text(args.name) || 'New vendor'}</p>
          <p className="truncate text-[11px] text-muted">{text(args.email) || 'Email missing'}</p>
        </div>
        <Badge className="ml-auto border-line bg-paper capitalize text-muted">{chain}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Payout address" value={address} />
        <Field label="NEAR account" value={text(args.nearAccountId)} />
        <Field label="Bank" value={text(args.bankName)} />
        <Field label="Account" value={text(args.bankAccount)} />
      </div>
      {addressError ? (
        <p className="mt-2 rounded-lg bg-rose-soft px-2.5 py-2 text-[11px] text-rose">
          {addressError}
        </p>
      ) : null}
      <Notice tone="draft">Creates an ACTIVE vendor in this workspace. No payment is made.</Notice>
    </div>
  );
}

function CustomerPreview({ args }: { args: Record<string, unknown> }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand">
          <Contact className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{text(args.name) || 'New customer'}</p>
          <p className="truncate text-[11px] text-muted">{text(args.email) || 'Email missing'}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tax ID" value={text(args.taxId)} />
        <Field label="Status" value="Active" />
        <div className="col-span-2">
          <Field label="Billing address" value={text(args.billingAddress)} />
        </div>
      </div>
      <Notice tone="draft">Creates an ACTIVE customer. No invoice is issued.</Notice>
    </div>
  );
}

function DocumentPreview({
  args,
  kind,
}: {
  args: Record<string, unknown>;
  kind: 'bill' | 'receivable';
}) {
  const { currency, decimals, taxBps, lines, totals, due } = invoicePreview(args);
  const autoSubmit = args.submit === true;
  const autoIssue = args.issue === true;
  const counterparty = text(kind === 'bill' ? args.vendor : args.customer);
  const Icon = kind === 'bill' ? FileText : Receipt;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">
            {text(args.number) || (kind === 'bill' ? 'New AP bill' : 'New AR invoice')}
          </p>
          <p className="truncate text-[11px] text-muted">
            {counterparty || (kind === 'bill' ? 'Vendor missing' : 'Customer missing')}
          </p>
        </div>
        <Badge className="ml-auto border-line bg-paper text-muted">
          {autoSubmit || autoIssue ? 'Create + advance' : 'Draft'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Currency" value={currency} />
        <Field label="Due" value={due} />
        <Field label="Tax" value={`${(taxBps / 100).toFixed(2)}%`} />
        <Field label="Lines" value={String(lines.length)} />
      </div>

      {lines.length ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-line">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 bg-paper px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit</span>
            <span className="text-right">Line</span>
          </div>
          <div className="divide-y divide-line">
            {lines.map((line, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-2.5 py-1.5 text-[11px]"
              >
                <span className="min-w-0 truncate">{line.description || 'Missing description'}</span>
                <span className="font-num text-right text-muted">{line.quantity}</span>
                <span className="font-num text-right text-muted">{line.unitPrice || '—'}</span>
                <span className="font-num text-right">
                  {totals?.lines[index]
                    ? money(totals.lines[index].lineTotal, decimals, currency)
                    : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-2 rounded-lg bg-rose-soft px-2.5 py-2 text-[11px] text-rose">
          At least one line item is required.
        </p>
      )}

      <div className="mt-2 space-y-1 rounded-lg bg-paper px-2.5 py-2 text-[11px]">
        <div className="flex justify-between">
          <span className="text-muted">Subtotal</span>
          <span className="font-num">{money(totals?.subtotal, decimals, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Tax</span>
          <span className="font-num">{money(totals?.taxAmount, decimals, currency)}</span>
        </div>
        <div className="flex justify-between border-t border-line pt-1 font-semibold">
          <span>Total</span>
          <span className="font-num">{money(totals?.total, decimals, currency)}</span>
        </div>
      </div>

      <Notice tone="draft">
        Creates a DRAFT {kind === 'bill' ? 'AP bill' : 'AR customer invoice'}.
        {autoSubmit ? ' Then submits it — AP submit does not post to the ledger.' : ''}
        {autoIssue ? ' Then issues it — AR issue posts to the ledger.' : ''}
        {!autoSubmit && !autoIssue ? ' Nothing posts to the ledger yet.' : ''}
      </Notice>
    </div>
  );
}

export function CreatePreview({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown>;
}) {
  switch (canonical(name)) {
    case 'create-vendor':
      return <VendorPreview args={args} />;
    case 'create-customer':
      return <CustomerPreview args={args} />;
    case 'create-bill':
      return <DocumentPreview args={args} kind="bill" />;
    case 'create-receivable':
      return <DocumentPreview args={args} kind="receivable" />;
    default:
      return (
        <p className="text-[11px] text-muted">
          {humanize(canonical(name))} · review the fields before approving.
        </p>
      );
  }
}

export function createApproveLabel(name: string, args: Record<string, unknown>): string | undefined {
  switch (canonical(name)) {
    case 'create-vendor':
      return 'Create vendor';
    case 'create-customer':
      return 'Create customer';
    case 'create-bill':
      return args.submit === true ? 'Create & submit bill' : 'Create draft bill';
    case 'create-receivable':
      return args.issue === true ? 'Create & issue invoice' : 'Create draft invoice';
    default:
      return undefined;
  }
}
