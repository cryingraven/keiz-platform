'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Building2, ChevronLeft, ChevronRight, Download, FileText, Plus, Search } from 'lucide-react';
import { formatUnits } from '@keiz/shared';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { downloadCsv } from '@/lib/csv';
import {
  DateFilterValue,
  DatePreset,
  EMPTY_DATE_FILTER,
  ListDateField,
  dateFilterQuery,
} from '@/lib/period';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { DateRangeFilter } from '@/components/date-range-filter';
import { InvoiceForm } from '@/components/invoice-form';
import { VendorForm } from '@/components/vendor-form';
import { Button, Card, EmptyState, ErrorState, Input, Select, StatusPill, TableSkeleton } from '@/components/ui';
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
type Filter = (typeof FILTERS)[number];

type Sort = 'newest' | 'due-asc' | 'due-desc' | 'amount-desc' | 'amount-asc';

const PAGE_SIZE = 25;

const PRESETS: DatePreset[] = [
  'all',
  'this-month',
  'last-month',
  'this-quarter',
  'last-quarter',
  'this-year',
  'custom',
];

function isFilter(value: string | null): value is Filter {
  return Boolean(value) && FILTERS.includes(value as Filter);
}

function isSort(value: string | null): value is Sort {
  return ['newest', 'due-asc', 'due-desc', 'amount-desc', 'amount-asc'].includes(value ?? '');
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<BillsFallback />}>
      <BillsContent />
    </Suspense>
  );
}

function BillsFallback() {
  return (
    <div>
      <PageHeader title="Bills" description="Vendor bills from draft to settlement." />
      <Card>
        <TableSkeleton rows={6} cols={4} />
      </Card>
    </div>
  );
}

function BillsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const statusParam = params.get('status');
  const filter: Filter = isFilter(statusParam) ? statusParam : 'ALL';
  const sort: Sort = isSort(params.get('sort')) ? (params.get('sort') as Sort) : 'newest';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const presetParam = params.get('preset') as DatePreset | null;
  const dateFieldParam = params.get('dateField') as ListDateField | null;
  const dateFilter: DateFilterValue = {
    preset: presetParam && PRESETS.includes(presetParam) ? presetParam : 'all',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    dateField: dateFieldParam ?? 'issueDate',
  };

  const [query, setQuery] = useState(params.get('q') ?? '');
  const [formOpen, setFormOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);
  const { session } = useAuth();
  const canAdmin = ['ADMIN', 'OWNER'].includes(session?.role ?? '');
  const paramsRef = useRef<URLSearchParams>(params);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const listPath = useMemo(() => `/invoices${dateFilterQuery(dateFilter)}`, [dateFilter]);
  const invoices = useApi<Invoice[]>(listPath);
  const vendors = useApi<Vendor[]>('/vendors');

  function replaceParams(next: URLSearchParams) {
    const text = next.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(paramsRef.current.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    replaceParams(next);
  }

  // Persist search in the URL so refresh and Back keep the same view.
  useEffect(() => {
    if (query === (params.get('q') ?? '')) return;
    const timer = window.setTimeout(() => {
      setParam('q', query || null);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function updateDateFilter(value: DateFilterValue) {
    const next = new URLSearchParams(paramsRef.current.toString());
    if (value.preset === 'all') {
      next.delete('preset');
      next.delete('from');
      next.delete('to');
    } else {
      next.set('preset', value.preset);
      if (value.from) next.set('from', value.from);
      else next.delete('from');
      if (value.to) next.set('to', value.to);
      else next.delete('to');
    }
    next.set('dateField', value.dateField);
    next.delete('page');
    replaceParams(next);
  }

  const vendorNames = useMemo(() => {
    const map = new Map<string, string>();
    (vendors.data ?? []).forEach((vendor) => map.set(vendor._id, vendor.name));
    return map;
  }, [vendors.data]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = (invoices.data ?? []).filter((invoice) => {
      const matchesFilter = filter === 'ALL' || invoice.status === filter;
      const matchesQuery =
        !needle ||
        invoice.number.toLowerCase().includes(needle) ||
        (vendorNames.get(invoice.vendorId) ?? '').toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
    const sorted = [...filtered];
    if (sort === 'due-asc') sorted.sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate));
    if (sort === 'due-desc') sorted.sort((a, b) => +new Date(b.dueDate) - +new Date(a.dueDate));
    if (sort === 'amount-desc')
      sorted.sort((a, b) => Number(b.total) / 10 ** b.decimals - Number(a.total) / 10 ** a.decimals);
    if (sort === 'amount-asc')
      sorted.sort((a, b) => Number(a.total) / 10 ** a.decimals - Number(b.total) / 10 ** b.decimals);
    return sorted;
  }, [invoices.data, filter, query, vendorNames, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasFilters = filter !== 'ALL' || Boolean(query.trim()) || dateFilter.preset !== 'all';

  function clearFilters() {
    setQuery('');
    const next = new URLSearchParams();
    if (sort !== 'newest') next.set('sort', sort);
    replaceParams(next);
  }

  const counts = useMemo(() => {
    const all = invoices.data ?? [];
    return {
      ALL: all.length,
      SUBMITTED: all.filter((row) => row.status === 'SUBMITTED').length,
      APPROVED: all.filter((row) => row.status === 'APPROVED').length,
      PAYMENT_PENDING: all.filter((row) => row.status === 'PAYMENT_PENDING').length,
      PAID: all.filter((row) => row.status === 'PAID').length,
      DRAFT: all.filter((row) => row.status === 'DRAFT').length,
    } as Record<Filter, number>;
  }, [invoices.data]);

  return (
    <div>
      <PageHeader
        title="Bills"
        description="What you owe vendors, from draft to settlement."
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
            {canAdmin ? (
              <Button variant="secondary" onClick={() => setVendorOpen(true)}>
                <Building2 className="h-3.5 w-3.5" /> New vendor
              </Button>
            ) : null}
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New bill
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex gap-1 overflow-x-auto border-b border-line scroll-thin"
            role="group"
            aria-label="Filter bills by status"
          >
            {FILTERS.map((item) => {
              const active = filter === item;
              return (
                <button
                  key={item}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParam('status', item === 'ALL' ? null : item)}
                  className={cn(
                    'relative shrink-0 px-2.5 py-2 text-small transition-colors',
                    active
                      ? 'font-medium text-ink after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ink'
                      : 'text-muted hover:text-ink',
                  )}
                >
                  {item === 'ALL' ? 'All' : humanize(item)}
                  <span className="ml-1.5 font-num text-meta text-muted">
                    {counts[item]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <Input
              aria-label="Search bills"
              placeholder="Search number or vendor"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <DateRangeFilter
            value={dateFilter}
            onChange={updateDateFilter}
            issueLabel="Bill date"
            includeCreatedAt
          />
          <div className="flex items-center gap-2">
            <label htmlFor="bill-sort" className="text-small text-muted">
              Sort
            </label>
            <Select
              id="bill-sort"
              value={sort}
              onChange={(event) => setParam('sort', event.target.value === 'newest' ? null : event.target.value)}
              className="w-auto min-w-[150px]"
            >
              <option value="newest">Newest first</option>
              <option value="due-asc">Due soonest</option>
              <option value="due-desc">Due latest</option>
              <option value="amount-desc">Amount, high to low</option>
              <option value="amount-asc">Amount, low to high</option>
            </Select>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden">
        {invoices.loading ? (
          <TableSkeleton rows={6} cols={4} />
        ) : invoices.error ? (
          <ErrorState message={invoices.error} onRetry={() => void invoices.reload()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title={hasFilters ? 'No bills match these filters' : 'No bills yet'}
            body={
              hasFilters
                ? 'Try a different status, date range or search term.'
                : 'Create your first vendor bill to start the approval flow.'
            }
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> New bill
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_140px_120px_32px] items-center gap-4 border-b border-line px-5 py-2.5 text-meta font-medium text-muted md:grid">
              <span>Bill</span>
              <span className="text-right">Amount</span>
              <span>Status</span>
              <span />
            </div>
            <ul className="divide-y divide-line">
              {visible.map((invoice) => {
                const overdue =
                  !['PAID', 'DRAFT', 'VOID'].includes(invoice.status) &&
                  new Date(invoice.dueDate).getTime() < Date.now();
                return (
                  <li key={invoice._id}>
                    <Link
                      href={`/dashboard/invoices/${invoice._id}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-surface-raised md:grid-cols-[minmax(0,1fr)_140px_120px_32px]"
                    >
                      <div className="min-w-0">
                        <p className="font-num text-ui font-medium">{invoice.number}</p>
                        <p className="truncate text-small text-muted">
                          {vendorNames.get(invoice.vendorId) ?? '—'}
                          <span className={overdue ? ' text-rose' : ''}>
                            {' '}
                            · {overdue ? 'overdue ' : 'due '}
                            {formatDate(invoice.dueDate)}
                          </span>
                        </p>
                      </div>
                      <p className="font-num text-right text-ui">
                        {formatMoney(invoice.total, invoice.decimals, invoice.currency)}
                      </p>
                      <div className="col-start-1 md:col-start-auto">
                        <StatusPill status={invoice.status} />
                      </div>
                      <ChevronRight className="hidden h-4 w-4 text-muted md:block" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            {rows.length > PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
                <p className="text-small text-muted">
                  Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, rows.length)} of{' '}
                  {rows.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={safePage === 1}
                    onClick={() => setParam('page', String(safePage - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={safePage === pageCount}
                    onClick={() => setParam('page', String(safePage + 1))}
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <InvoiceForm
        open={formOpen}
        vendors={vendors.data ?? []}
        onClose={() => setFormOpen(false)}
        onCreated={() => void invoices.reload()}
      />
      <VendorForm
        key={vendorOpen ? 'open' : 'closed'}
        open={vendorOpen}
        onClose={() => setVendorOpen(false)}
        onCreated={() => void vendors.reload()}
      />
    </div>
  );
}
