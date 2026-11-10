'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronRight, Download, HandCoins, Plus, Search, UserPlus } from 'lucide-react';
import { formatUnits } from '@keiz/shared';
import { useApi } from '@/lib/hooks';
import { downloadCsv } from '@/lib/csv';
import { DateFilterValue, EMPTY_DATE_FILTER, dateFilterQuery } from '@/lib/period';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { DateRangeFilter } from '@/components/date-range-filter';
import { CustomerForm, ReceivableForm } from '@/components/receivable-form';
import { Button, Card, EmptyState, ErrorState, Input, StatusPill, TableSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Receivable {
  _id: string;
  number: string;
  customerId: string;
  status: string;
  total: string;
  paidAmount: string;
  decimals: number;
  currency: string;
  dueDate: string;
}
interface Customer {
  _id: string;
  name: string;
  email: string;
}
interface Summary {
  currency: string;
  decimals: number;
  outstanding: string;
  overdue: string;
  collected: string;
  openCount: number;
}

const FILTERS = ['ALL', 'DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'VOID'] as const;

function isOverdue(row: Receivable): boolean {
  if (!['ISSUED', 'PARTIALLY_PAID'].includes(row.status)) return false;
  return new Date(row.dueDate).getTime() < Date.now();
}

export default function ReceivablesPage() {
  const [dateFilter, setDateFilter] = useState<DateFilterValue>(EMPTY_DATE_FILTER);
  const dateQuery = useMemo(() => dateFilterQuery(dateFilter), [dateFilter]);
  const receivables = useApi<Receivable[]>(`/receivables${dateQuery}`);
  const customers = useApi<Customer[]>('/customers');
  const summary = useApi<Summary>(`/receivables/summary${dateQuery}`);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);

  const customerNames = useMemo(() => {
    const map = new Map<string, string>();
    (customers.data ?? []).forEach((customer) => map.set(customer._id, customer.name));
    return map;
  }, [customers.data]);

  const rows = useMemo(() => {
    return (receivables.data ?? []).filter((row) => {
      const matchesFilter =
        filter === 'ALL' ||
        (filter === 'OVERDUE' ? isOverdue(row) : row.status === filter);
      const matchesQuery =
        !query ||
        row.number.toLowerCase().includes(query.toLowerCase()) ||
        (customerNames.get(row.customerId) ?? '').toLowerCase().includes(query.toLowerCase());
      return matchesFilter && matchesQuery;
    });
  }, [receivables.data, filter, query, customerNames]);

  return (
    <div>
      <PageHeader
        title="Receivables"
        description="Customer invoices from issue to cash collected."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCsv(
                  'keiz-receivables.csv',
                  rows.map((row) => ({
                    number: row.number,
                    customer: customerNames.get(row.customerId) ?? '',
                    status: row.status,
                    currency: row.currency,
                    total: formatUnits(row.total, row.decimals),
                    paid: formatUnits(row.paidAmount, row.decimals),
                    outstanding: formatUnits(
                      (BigInt(row.total) - BigInt(row.paidAmount)).toString(),
                      row.decimals,
                    ),
                    dueDate: row.dueDate,
                  })),
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button variant="secondary" onClick={() => setCustomerOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Add customer
            </Button>
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New invoice
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted">Outstanding</p>
          <p className="font-num mt-1.5 text-xl font-semibold">
            {summary.data
              ? formatMoney(summary.data.outstanding, summary.data.decimals, summary.data.currency)
              : '—'}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            {summary.data?.openCount ?? 0} open invoice(s)
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted">Overdue</p>
          <p className="font-num mt-1.5 text-xl font-semibold text-rose">
            {summary.data
              ? formatMoney(summary.data.overdue, summary.data.decimals, summary.data.currency)
              : '—'}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">Past the due date</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted">Collected</p>
          <p className="font-num mt-1.5 text-xl font-semibold text-mint">
            {summary.data
              ? formatMoney(summary.data.collected, summary.data.decimals, summary.data.currency)
              : '—'}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">Recorded receipts</p>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => {
            const count =
              item === 'ALL'
                ? (receivables.data?.length ?? 0)
                : (receivables.data ?? []).filter((row) =>
                    item === 'OVERDUE' ? isOverdue(row) : row.status === item,
                  ).length;
            return (
              <button
                key={item}
                onClick={() => setFilter(item)}
                aria-pressed={filter === item}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[12px] font-medium transition',
                  filter === item
                    ? 'border-ink bg-ink text-white'
                    : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {humanize(item)}
                <span
                  className={cn(
                    'ml-1.5 font-num',
                    filter === item ? 'text-white/60' : 'text-muted/60',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search number or customer"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="mb-4">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} issueLabel="Invoice date" />
      </div>

      <Card className="overflow-hidden">
        {receivables.loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : receivables.error ? (
          <ErrorState message={receivables.error} onRetry={() => void receivables.reload()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<HandCoins className="h-5 w-5" />}
            title={query || filter !== 'ALL' ? 'No matches' : 'No customer invoices yet'}
            body={
              query || filter !== 'ALL'
                ? 'Try a different filter or clear the search.'
                : 'Issue your first customer invoice to start tracking receivables.'
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
                <Button onClick={() => setFormOpen(true)}>New invoice</Button>
              )
            }
          />
        ) : (
          <>
          <ul className="divide-y divide-line md:hidden">
            {rows.map((row) => {
              const outstanding = BigInt(row.total) - BigInt(row.paidAmount);
              return (
                <li key={row._id}>
                  <Link
                    href={`/dashboard/receivables/${row._id}`}
                    className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-paper/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-num text-[14px] font-medium">{row.number}</p>
                      <p className="truncate text-[12px] text-muted">
                        {customerNames.get(row.customerId) ?? '—'} · due {formatDate(row.dueDate)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-num text-[14px]">
                        {formatMoney(outstanding.toString(), row.decimals, row.currency)}
                      </p>
                      <div className="mt-1 flex justify-end">
                        <StatusPill status={isOverdue(row) ? 'OVERDUE' : row.status} />
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Due</th>
                  <th className="px-5 py-3 text-right font-medium">Total</th>
                  <th className="px-5 py-3 text-right font-medium">Outstanding</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => {
                  const outstanding = BigInt(row.total) - BigInt(row.paidAmount);
                  return (
                    <tr key={row._id} className="group transition hover:bg-paper/60">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/dashboard/receivables/${row._id}`}
                          className="font-num text-[14px] font-medium group-hover:text-brand"
                        >
                          {row.number}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-[14px] text-muted">
                        {customerNames.get(row.customerId) ?? '—'}
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-muted">
                        {formatDate(row.dueDate)}
                      </td>
                      <td className="font-num px-5 py-3.5 text-right text-[14px]">
                        {formatMoney(row.total, row.decimals, row.currency)}
                      </td>
                      <td className="font-num px-5 py-3.5 text-right text-[14px]">
                        {formatMoney(outstanding.toString(), row.decimals, row.currency)}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusPill status={isOverdue(row) ? 'OVERDUE' : row.status} />
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link href={`/dashboard/receivables/${row._id}`}>
                          <ChevronRight className="ml-auto h-4 w-4 text-muted transition group-hover:text-ink" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <ReceivableForm
        open={formOpen}
        customers={customers.data ?? []}
        onClose={() => setFormOpen(false)}
        onCreated={() => {
          void receivables.reload();
          void summary.reload();
        }}
      />
      <CustomerForm
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        onCreated={() => void customers.reload()}
      />
    </div>
  );
}
