'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeftRight, Boxes, ChevronRight } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { DateFilterValue, EMPTY_DATE_FILTER, dateFilterQuery } from '@/lib/period';
import { formatDate, shortAddress, timeLeft } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { DateRangeFilter } from '@/components/date-range-filter';
import { NearIntentsLogo } from '@/components/landing/logos';
import { Badge, Card, EmptyState, ErrorState, SectionTitle, StatusPill, TableSkeleton } from '@/components/ui';

interface Payment {
  _id: string;
  invoiceId: string;
  status: string;
  provider: string;
  payer: string;
  originSymbol?: string;
  destinationSymbol?: string;
  destinationChain?: string;
  amountInFormatted?: string;
  amountOutFormatted?: string;
  depositAddress?: string;
  deadline?: string;
  createdAt: string;
  destinationTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
}
interface Invoice {
  _id: string;
  number: string;
}
interface ChainEvent {
  _id: string;
  txHash: string;
  kind: string;
  status?: string;
  observedAt: string;
}

export default function PaymentsPage() {
  const [dateFilter, setDateFilter] = useState<DateFilterValue>(EMPTY_DATE_FILTER);
  const dateQuery = useMemo(() => dateFilterQuery(dateFilter, false), [dateFilter]);
  const payments = useApi<Payment[]>(`/payments${dateQuery}`, { pollMs: 4000 });
  const invoices = useApi<Invoice[]>('/invoices');
  const events = useApi<ChainEvent[]>('/indexer/events');

  const invoiceNumbers = useMemo(() => {
    const map = new Map<string, string>();
    (invoices.data ?? []).forEach((invoice) => map.set(invoice._id, invoice.number));
    return map;
  }, [invoices.data]);

  const open = (payments.data ?? []).filter((payment) =>
    ['AWAITING_DEPOSIT', 'PROCESSING'].includes(payment.status),
  );

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Every quote, deposit and settlement, straight from the ledger."
        actions={
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-[11px] uppercase tracking-wider text-muted">Settled by</span>
            <NearIntentsLogo />
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="Open" value={String(open.length)} hint="Awaiting deposit or processing" />
        <MiniStat
          label="Settled"
          value={String((payments.data ?? []).filter((p) => p.status === 'SUCCEEDED').length)}
          hint="Terminal success"
        />
        <MiniStat
          label="Indexed events"
          value={String(events.data?.length ?? 0)}
          hint="On-chain observations"
        />
      </div>

      <div className="mt-5">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} showDateField={false} />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <SectionTitle title="Payment ledger" hint="Newest first" />
          <Badge className="border-line bg-paper text-muted" dot>
            polling every 4s
          </Badge>
        </div>

        {payments.loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : payments.error ? (
          <ErrorState message={payments.error} onRetry={() => void payments.reload()} />
        ) : (payments.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight className="h-5 w-5" />}
            title="No payments yet"
            body="Open an approved invoice and request a quote to create the first settlement."
          />
        ) : (
          <>
          <ul className="divide-y divide-line md:hidden">
            {(payments.data ?? []).map((payment) => (
              <li key={payment._id}>
                <Link
                  href={`/dashboard/invoices/${payment.invoiceId}`}
                  className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-paper/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-num text-[14px] font-medium">
                      {invoiceNumbers.get(payment.invoiceId) ?? shortAddress(payment.invoiceId, 4)}
                    </p>
                    <p className="truncate text-[12px] text-muted">
                      {payment.originSymbol ?? 'USDC'} → {payment.destinationSymbol ?? 'USDC'} on{' '}
                      {payment.destinationChain ?? 'near'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-num text-[14px]">{payment.amountOutFormatted ?? '—'}</p>
                    <div className="mt-1 flex justify-end">
                      <StatusPill status={payment.status} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Route</th>
                  <th className="px-5 py-3 text-right font-medium">Vendor receives</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Deadline</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(payments.data ?? []).map((payment) => (
                  <tr key={payment._id} className="group transition hover:bg-paper/60">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/dashboard/invoices/${payment.invoiceId}`}
                        className="font-num text-[14px] font-medium group-hover:text-brand"
                      >
                        {invoiceNumbers.get(payment.invoiceId) ?? shortAddress(payment.invoiceId, 4)}
                      </Link>
                      <p className="text-[11px] text-muted">
                        {payment.payer === 'AGENT' ? 'Agent wallet' : 'Human'} · {payment.provider}
                      </p>
                    </td>
                    <td className="px-5 py-3.5 text-[13px]">
                      <span className="font-medium">{payment.originSymbol ?? 'USDC'}</span>
                      <span className="text-muted"> → </span>
                      <span className="font-medium">{payment.destinationSymbol ?? 'USDC'}</span>
                      <span className="text-muted"> on {payment.destinationChain ?? 'near'}</span>
                    </td>
                    <td className="font-num px-5 py-3.5 text-right text-[14px]">
                      {payment.amountOutFormatted ?? '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusPill status={payment.status} />
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted">
                      {['AWAITING_DEPOSIT', 'PROCESSING'].includes(payment.status)
                        ? timeLeft(payment.deadline)
                        : formatDate(payment.createdAt)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link href={`/dashboard/invoices/${payment.invoiceId}`}>
                        <ChevronRight className="ml-auto h-4 w-4 text-muted transition group-hover:text-ink" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <SectionTitle
            title="Chain index"
            hint="Upserted by (txHash, eventIndex) — re-polling cannot duplicate rows"
          />
          <Boxes className="h-4 w-4 text-muted" />
        </div>
        {(events.data?.length ?? 0) === 0 ? (
          <div className="px-5 py-6 text-[13px] text-muted">
            No on-chain events indexed yet. In <span className="font-num">intents</span> mode the
            indexer reads deposits through NEAR RPC and stores a normalised row here. Mock payments
            are intentionally skipped.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {(events.data ?? []).map((event) => (
              <li key={event._id} className="flex items-center gap-3 px-5 py-3">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                <span className="text-[13px] font-medium">{event.kind}</span>
                <span className="font-num truncate text-[12px] text-muted">{event.txHash}</span>
                <span className="ml-auto text-[12px]">
                  <StatusPill status={event.status ?? 'SUCCEEDED'} />
                </span>
                <span className="w-28 text-right text-[11px] text-muted">
                  {formatDate(event.observedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="font-num mt-1 text-xl font-semibold">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
    </Card>
  );
}
