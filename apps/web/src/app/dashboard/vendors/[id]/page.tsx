'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Building2, Mail } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { Card, SectionTitle, Spinner, StatusPill } from '@/components/ui';

interface Vendor {
  _id: string;
  name: string;
  email: string;
  nearAccountId?: string;
  payoutChain: string;
  payoutAddress: string;
  bankName?: string;
  bankAccount?: string;
  status: string;
}

interface Invoice {
  _id: string;
  number: string;
  status: string;
  currency: string;
  decimals: number;
  total: string;
  dueDate: string;
}

export default function VendorDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const vendor = useApi<Vendor>(id ? `/vendors/${id}` : null);
  const bills = useApi<Invoice[]>(id ? `/invoices?vendorId=${encodeURIComponent(id)}` : null);

  if (vendor.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading vendor
      </div>
    );
  }

  if (!vendor.data) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-semibold">Vendor not found</p>
        <p className="mt-1 text-sm text-muted">It may belong to another workspace.</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/vendors')}
          className="mt-4 text-xs font-medium text-brand hover:underline"
        >
          Back to vendors
        </button>
      </Card>
    );
  }

  const data = vendor.data;
  return (
    <div>
      <Link
        href="/dashboard/vendors"
        className="mb-5 inline-flex items-center gap-1.5 text-[12px] text-muted transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Vendors
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
              <Building2 className="h-4 w-4" />
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
          <SectionTitle title="Payout details" />
          <dl className="mt-3 space-y-2 text-[12px]">
            <Row label="Chain" value={data.payoutChain} />
            <Row label="Address" value={data.payoutAddress} mono />
            {data.nearAccountId ? <Row label="NEAR account" value={data.nearAccountId} mono /> : null}
            {data.bankName ? <Row label="Bank" value={data.bankName} /> : null}
            {data.bankAccount ? <Row label="Account" value={data.bankAccount} mono /> : null}
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <SectionTitle title="Bills" hint={`${bills.data?.length ?? 0} invoice(s)`} />
          </div>
          {bills.loading ? (
            <div className="px-5 py-6">
              <Spinner />
            </div>
          ) : (bills.data?.length ?? 0) === 0 ? (
            <p className="px-5 py-6 text-[12px] text-muted">No bills for this vendor yet.</p>
          ) : (
            <div className="divide-y divide-line">
              {(bills.data ?? []).map((invoice) => (
                <Link
                  key={invoice._id}
                  href={`/dashboard/invoices/${invoice._id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-paper"
                >
                  <div className="min-w-0">
                    <p className="font-num text-[12px] font-medium">{invoice.number}</p>
                    <p className="text-[10px] text-muted">due {formatDate(invoice.dueDate)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill status={invoice.status} />
                    <span className="font-num text-[12px]">
                      {formatMoney(invoice.total, invoice.decimals, invoice.currency)}
                    </span>
                  </div>
                </Link>
              ))}
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
