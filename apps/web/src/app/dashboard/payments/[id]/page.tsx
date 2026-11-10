'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowUpRight, ChevronRight, CreditCard } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { formatDate, humanize, shortAddress } from '@/lib/format';
import { Card, SectionTitle, Spinner, StatusPill } from '@/components/ui';

interface Payment {
  _id: string;
  invoiceId: string;
  provider: string;
  status: string;
  rawStatus?: string;
  payer: string;
  originSymbol?: string;
  destinationSymbol?: string;
  destinationChain?: string;
  amountInFormatted?: string;
  amountOutFormatted?: string;
  depositAddress?: string;
  deadline?: string;
  txHash?: string;
  destinationTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
  createdAt: string;
}

interface PaymentEvent {
  _id: string;
  status: string;
  rawStatus?: string;
  createdAt: string;
}

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const payment = useApi<Payment>(id ? `/payments/${id}` : null);
  const events = useApi<PaymentEvent[]>(id ? `/payments/${id}/events` : null);

  if (payment.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading payment
      </div>
    );
  }

  if (!payment.data) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-semibold">Payment not found</p>
        <p className="mt-1 text-sm text-muted">It may belong to another workspace.</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/payments')}
          className="mt-4 text-xs font-medium text-brand hover:underline"
        >
          Back to payments
        </button>
      </Card>
    );
  }

  const data = payment.data;
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-1.5 text-[12px] text-muted">
        <Link href="/dashboard" className="transition hover:text-ink">
          Workspace
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/dashboard/payments" className="transition hover:text-ink">
          Payments
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-num font-medium text-ink">{shortAddress(data._id, 6)}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
              <CreditCard className="h-4 w-4" />
            </span>
            <h1 className="truncate font-num text-xl font-semibold tracking-tight">
              {data._id.slice(-10)}
            </h1>
            <StatusPill status={data.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {data.provider} · {data.payer} · created {formatDate(data.createdAt)}
          </p>
        </div>
        <Link
          href={`/dashboard/invoices/${data.invoiceId}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium transition hover:bg-paper"
        >
          View invoice <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card className="p-5">
          <SectionTitle title="Transfer" />
          <dl className="mt-3 space-y-2 text-[13px]">
            <Row label="Provider" value={data.provider} />
            <Row label="Status" value={humanize(data.status)} />
            {data.rawStatus ? <Row label="Provider status" value={data.rawStatus} /> : null}
            {data.originSymbol ? (
              <Row
                label="Amount in"
                value={`${data.originSymbol} ${data.amountInFormatted ?? '—'}`}
                mono
              />
            ) : null}
            {data.destinationSymbol ? (
              <Row
                label="Amount out"
                value={`${data.destinationSymbol} ${data.amountOutFormatted ?? '—'}`}
                mono
              />
            ) : null}
            {data.destinationChain ? <Row label="Destination chain" value={data.destinationChain} /> : null}
            {data.depositAddress ? <Row label="Deposit address" value={data.depositAddress} mono /> : null}
            {data.txHash ? <Row label="Origin tx" value={data.txHash} mono /> : null}
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <SectionTitle title="Timeline" hint={`${events.data?.length ?? 0} event(s)`} />
          </div>
          {events.loading ? (
            <div className="px-5 py-6">
              <Spinner />
            </div>
          ) : (events.data?.length ?? 0) === 0 ? (
            <p className="px-5 py-6 text-[13px] text-muted">No events recorded yet.</p>
          ) : (
            <ol className="divide-y divide-line">
              {(events.data ?? []).map((event) => (
                <li key={event._id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-[13px] font-medium">{humanize(event.status)}</p>
                    {event.rawStatus ? (
                      <p className="text-[11px] text-muted">{event.rawStatus}</p>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-muted">{formatDate(event.createdAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={mono ? 'break-all text-right font-num' : 'text-right'}>{value}</dd>
    </div>
  );
}
