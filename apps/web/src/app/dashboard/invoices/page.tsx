'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronRight, Download, FileText, Plus, Search } from 'lucide-react';
import { formatUnits } from '@keiz/shared';
import { useApi } from '@/lib/hooks';
import { downloadCsv } from '@/lib/csv';
import { DateFilterValue, EMPTY_DATE_FILTER, dateFilterQuery } from '@/lib/period';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { DateRangeFilter } from '@/components/date-range-filter';
import { InvoiceForm } from '@/components/invoice-form';
import { Button, Card, EmptyState, ErrorState, Input, Spinner, StatusPill } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Invoice {
  _id: string;
  number: string;
  status: string;
  total: string;
  decimals: number;
  currency: string;
  dueDate: string;
  vendorId: string;
}
interface Vendor {
  _id: string;
  name: string;
}

const FILTERS = ['ALL', 'SUBMITTED', 'APPROVED', 'PAYMENT_PENDING', 'PAID', 'DRAFT'] as const;

export default function InvoicesPage() {
  const [dateFilter, setDateFilter] = useState<DateFilterValue>(EMPTY_DATE_FILTER);
  const listPath = useMemo(() => `/invoices${dateFilterQuery(dateFilter)}`, [dateFilter]);
  const invoices = useApi<Invoice[]>(listPath);
  const vendors = useApi<Vendor[]>('/vendors');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const vendorNames = useMemo(() => {
    const map = new Map<string, string>();
    (vendors.data ?? []).forEach((vendor) => map.set(vendor._id, vendor.name));
    return map;
  }, [vendors.data]);

  const rows = useMemo(() => {
    return (invoices.data ?? []).filter((invoice) => {
      const matchesFilter = filter === 'ALL' || invoice.status === filter;
      const matchesQuery =
        !query ||
        invoice.number.toLowerCase().includes(query.toLowerCase()) ||
        (vendorNames.get(invoice.vendorId) ?? '').toLowerCase().includes(query.toLowerCase());
      return matchesFilter && matchesQuery;
    });
  }, [invoices.data, filter, query, vendorNames]);

  return (
    <div>
      <PageHeader
        title="Bills (AP)"
        description="Vendor bills from draft to settlement."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCsv(
                  'keiz-bills.csv',
                  rows.map((invoice) => ({
                    number: invoice.number,
                    vendor: vendorNames.get(invoice.vendorId) ?? '',
                    status: invoice.status,
                    currency: invoice.currency,
                    total: formatUnits(invoice.total, invoice.decimals),
                    dueDate: invoice.dueDate,
                  })),
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New bill
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => {
            const count =
              item === 'ALL'
                ? (invoices.data?.length ?? 0)
                : (invoices.data ?? []).filter((invoice) => invoice.status === item).length;
            return (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[11px] font-medium transition',
                  filter === item
                    ? 'border-ink bg-ink text-white'
                    : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {humanize(item)}
                <span className={cn('ml-1.5 font-num', filter === item ? 'text-white/60' : 'text-muted/60')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search number or vendor"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="mb-4">
        <DateRangeFilter
          value={dateFilter}
          onChange={setDateFilter}
          issueLabel="Bill date"
          includeCreatedAt
        />
      </div>

      <Card className="overflow-hidden">
        {invoices.loading ? (
          <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted">
            <Spinner /> Loading invoices
          </div>
        ) : invoices.error ? (
          <ErrorState message={invoices.error} onRetry={() => void invoices.reload()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title={query || filter !== 'ALL' ? 'No matches' : 'No bills yet'}
            body={
              query || filter !== 'ALL'
                ? 'Try a different filter or clear the search.'
                : 'Create your first vendor bill to start the approval flow.'
            }
            action={
              query || filter !== 'ALL' ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setFilter('ALL');
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button onClick={() => setFormOpen(true)}>New bill</Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wider text-muted">
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Vendor</th>
                  <th className="px-5 py-3 font-medium">Due</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((invoice) => (
                  <tr key={invoice._id} className="group transition hover:bg-paper/60">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/dashboard/invoices/${invoice._id}`}
                        className="font-num text-[13px] font-medium group-hover:text-brand"
                      >
                        {invoice.number}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-muted">
                      {vendorNames.get(invoice.vendorId) ?? '—'}
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted">
                      {formatDate(invoice.dueDate)}
                    </td>
                    <td className="font-num px-5 py-3.5 text-right text-[13px]">
                      {formatMoney(invoice.total, invoice.decimals, invoice.currency)}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusPill status={invoice.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link href={`/dashboard/invoices/${invoice._id}`}>
                        <ChevronRight className="ml-auto h-4 w-4 text-muted transition group-hover:text-ink" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InvoiceForm
        open={formOpen}
        vendors={vendors.data ?? []}
        onClose={() => setFormOpen(false)}
        onCreated={() => void invoices.reload()}
      />
    </div>
  );
}
