'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronRight, Contact, Mail } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { Card, SectionTitle, Spinner, StatusPill } from '@/components/ui';

interface Customer {
  _id: string;
  name: string;
  email: string;
  taxId?: string;
  billingAddress?: string;
  status: string;
}

interface Receivable {
  _id: string;
  number: string;
  status: string;
  currency: string;
  decimals: number;
  total: string;
  paidAmount: string;
  dueDate: string;
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const customer = useApi<Customer>(id ? `/customers/${id}` : null);
  const receivables = useApi<Receivable[]>(
    id ? `/receivables?customerId=${encodeURIComponent(id)}` : null,
  );

  if (customer.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading customer
      </div>
    );
  }

  if (!customer.data) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-semibold">Customer not found</p>
        <p className="mt-1 text-sm text-muted">It may belong to another workspace.</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/customers')}
          className="mt-4 text-xs font-medium text-brand hover:underline"
        >
          Back to customers
        </button>
      </Card>
    );
  }

  const data = customer.data;
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-1.5 text-[12px] text-muted">
        <Link href="/dashboard" className="transition hover:text-ink">
          Workspace
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/dashboard/customers" className="transition hover:text-ink">
          Customers
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate font-medium text-ink">{data.name}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
              <Contact className="h-4 w-4" />
            </span>
            <h1 className="truncate text-2xl font-semibold tracking-tight">{data.name}</h1>
            <StatusPill status={data.status} />
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <Mail className="h-3.5 w-3.5" /> {data.email}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
        <Card className="p-5">
          <SectionTitle title="Profile" />
          <dl className="mt-3 space-y-2 text-[13px]">
            <Row label="Email" value={data.email} />
            {data.taxId ? <Row label="Tax id" value={data.taxId} mono /> : null}
            {data.billingAddress ? (
              <Row label="Billing" value={data.billingAddress} />
            ) : null}
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <SectionTitle
              title="Customer invoices"
              hint={`${receivables.data?.length ?? 0} receivable(s)`}
            />
          </div>
          {receivables.loading ? (
            <div className="px-5 py-6">
              <Spinner />
            </div>
          ) : (receivables.data?.length ?? 0) === 0 ? (
            <p className="px-5 py-6 text-[13px] text-muted">No customer invoices yet.</p>
          ) : (
            <div className="divide-y divide-line">
              {(receivables.data ?? []).map((row) => {
                const outstanding = BigInt(row.total) - BigInt(row.paidAmount);
                return (
                  <Link
                    key={row._id}
                    href={`/dashboard/receivables/${row._id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-paper"
                  >
                    <div className="min-w-0">
                      <p className="font-num text-[13px] font-medium">{row.number}</p>
                      <p className="text-[11px] text-muted">due {formatDate(row.dueDate)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusPill status={row.status} />
                      <span className="font-num text-[13px]">
                        {formatMoney(outstanding.toString(), row.decimals, row.currency)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
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
