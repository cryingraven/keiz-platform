import { Download, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDate, formatMoney } from '@/lib/format';
import { Badge, Button } from '@/components/ui';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';
import type { PublicDocument } from './types';

function formatUnitPrice(value: string, currency: string): string {
  const amount = Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function statusTone(status: string): string {
  if (status === 'Paid') return 'border-mint/20 bg-mint-soft text-mint';
  if (status === 'Overdue') return 'border-rose/20 bg-rose-soft text-rose';
  if (status === 'Partially paid') return 'border-amber/20 bg-amber-soft text-amber';
  return 'border-brand/20 bg-brand-soft text-brand-deep';
}

export function PublicDocumentView({
  document,
  onDownload,
  downloading,
  children,
}: {
  document: PublicDocument;
  onDownload: () => void;
  downloading: boolean;
  children?: ReactNode;
}) {
  const money = (value: string) =>
    formatMoney(value, document.decimals, document.currency);

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-mint" />
            Shared document
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(11,13,18,0.03)]">
          <div className="border-b border-line px-5 py-5 sm:px-8 sm:py-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                  {document.organizationName}
                </p>
                <h1 className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em]">
                  {document.title} {document.number}
                </h1>
                <p className="mt-2 text-[13px] text-muted">
                  Issued {formatDate(document.issueDate)} · Due{' '}
                  {formatDate(document.dueDate)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge dot className={statusTone(document.status)}>
                  {document.status}
                </Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={downloading}
                  onClick={onDownload}
                >
                  {downloading ? null : <Download className="h-3.5 w-3.5" />}
                  Download PDF
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-5 border-b border-line px-5 py-5 sm:grid-cols-2 sm:px-8">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
                {document.kind === 'bill' ? 'Vendor' : 'Bill to'}
              </p>
              <p className="mt-1.5 text-[14px] font-semibold">{document.counterparty.name}</p>
              {document.counterparty.email ? (
                <p className="mt-0.5 text-[12px] text-muted">{document.counterparty.email}</p>
              ) : null}
              {document.counterparty.billingAddress ? (
                <p className="mt-1 max-w-xs whitespace-pre-wrap text-[12px] leading-relaxed text-muted">
                  {document.counterparty.billingAddress}
                </p>
              ) : null}
              {document.counterparty.taxId ? (
                <p className="mt-1 text-[12px] text-muted">
                  Tax ID: <span className="font-num text-ink">{document.counterparty.taxId}</span>
                </p>
              ) : null}
            </div>
            <div className="sm:text-right">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
                {document.kind === 'bill' ? 'Bill total' : 'Invoice total'}
              </p>
              <p className="font-num mt-1.5 text-[24px] font-semibold tracking-tight">
                {money(document.total)}
              </p>
              {document.amountDue !== undefined ? (
                <p className="mt-1 text-[12px] text-muted">
                  Amount due{' '}
                  <span className="font-num font-medium text-ink">
                    {money(document.amountDue)}
                  </span>
                </p>
              ) : null}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left">
              <thead>
                <tr className="border-b border-line bg-paper/50 text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="px-5 py-2.5 font-medium sm:px-8">
                    Description
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Qty
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Unit
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium sm:px-8">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {document.lineItems.map((line, index) => (
                  <tr key={index} className="text-[13px]">
                    <td className="px-5 py-3 sm:px-8">{line.description}</td>
                    <td className="font-num px-3 py-3 text-right text-muted">{line.quantity}</td>
                    <td className="font-num px-3 py-3 text-right text-muted">
                      {formatUnitPrice(line.unitPrice, document.currency)}
                    </td>
                    <td className="font-num px-5 py-3 text-right sm:px-8">
                      {money(line.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-line px-5 py-5 sm:px-8">
            <div className="ml-auto max-w-xs space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-6 text-muted">
                <span>Subtotal</span>
                <span className="font-num">{money(document.subtotal)}</span>
              </div>
              <div className="flex justify-between gap-6 text-muted">
                <span>Tax ({(document.taxBps / 100).toFixed(2)}%)</span>
                <span className="font-num">{money(document.taxAmount)}</span>
              </div>
              <div className="flex justify-between gap-6 border-t border-line pt-2 font-semibold">
                <span>Total</span>
                <span className="font-num">{money(document.total)}</span>
              </div>
              {document.paidAmount !== undefined ? (
                <div className="flex justify-between gap-6 text-muted">
                  <span>Amount paid</span>
                  <span className="font-num">{money(document.paidAmount)}</span>
                </div>
              ) : null}
              {document.amountDue !== undefined ? (
                <div
                  className={cn(
                    'flex justify-between gap-6 border-t border-line pt-2 font-semibold',
                    BigInt(document.amountDue) > 0n ? 'text-ink' : 'text-mint',
                  )}
                >
                  <span>Amount due</span>
                  <span className="font-num">{money(document.amountDue)}</span>
                </div>
              ) : null}
            </div>
          </div>

          {document.notes ? (
            <div className="border-t border-line bg-paper/40 px-5 py-4 sm:px-8">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Notes</p>
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                {document.notes}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-mint" />
            Shared securely by {document.organizationName}
          </span>
          {document.expiresAt ? <span>Link expires {formatDate(document.expiresAt)}</span> : null}
        </div>

        {children}
      </main>
    </div>
  );
}
