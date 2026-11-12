'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Download, Search } from 'lucide-react';
import { downloadApiFile } from '@/lib/download';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useToast } from '@/components/feedback';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  StatusPill,
  TableSkeleton,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { AccountOption, JournalPage } from './types';

const SOURCE_TYPES = [
  'invoice',
  'receivable',
  'receipt',
  'manual',
  'opening',
  'expense',
  'revenue',
] as const;
const PAGE_SIZES = [25, 50, 100] as const;

function pageWindow(current: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const start = Math.max(1, Math.min(current - 2, totalPages - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}

export function JournalTab({
  currency,
  from,
  to,
  accounts,
  focusEntry,
  refreshToken = 0,
}: {
  currency: string;
  from?: string;
  to?: string;
  accounts: AccountOption[];
  focusEntry?: string | null;
  refreshToken?: number;
}) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [accountCode, setAccountCode] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [expanded, setExpanded] = useState<string | null>(focusEntry ?? null);
  const [exporting, setExporting] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      if (next !== q) {
        setQ(next);
        setPage(1);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, q]);

  const params = useMemo(() => {
    const next = new URLSearchParams();
    next.set('currency', currency);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    if (q) next.set('q', q);
    if (accountCode) next.set('accountCode', accountCode);
    if (sourceType) next.set('sourceType', sourceType);
    next.set('page', String(page));
    next.set('pageSize', String(pageSize));
    return next;
  }, [currency, from, to, q, accountCode, sourceType, page, pageSize]);

  const journal = useApi<JournalPage>(`/accounting/journal-entries?${params.toString()}`);
  const data = journal.data;

  useEffect(() => {
    if (refreshToken > 0) void journal.reload();
  }, [refreshToken, journal.reload]);

  useEffect(() => {
    if (data && data.totalPages > 0 && page > data.totalPages) {
      setPage(data.totalPages);
    }
  }, [data, page]);

  function goTo(nextPage: number) {
    setPage(nextPage);
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function exportCsv() {
    const next = new URLSearchParams();
    next.set('currency', currency);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    if (q) next.set('q', q);
    if (accountCode) next.set('accountCode', accountCode);
    if (sourceType) next.set('sourceType', sourceType);
    next.set('format', 'csv');

    setExporting(true);
    try {
      await downloadApiFile(`/accounting/journal-entries/export?${next.toString()}`);
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Could not export the journal',
        'error',
      );
    } finally {
      setExporting(false);
    }
  }

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">Journal</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Append-only ledger transactions, newest first.
          </p>
        </div>
        <Button variant="secondary" size="sm" loading={exporting} onClick={() => void exportCsv()}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search memo or account"
            aria-label="Search journal entries"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          aria-label="Filter by account"
          value={accountCode}
          onChange={(event) => {
            setAccountCode(event.target.value);
            setPage(1);
          }}
          className="w-auto min-w-[150px]"
        >
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.code} value={account.code}>
              {account.code} · {account.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by source"
          value={sourceType}
          onChange={(event) => {
            setSourceType(event.target.value);
            setPage(1);
          }}
          className="w-auto min-w-[130px]"
        >
          <option value="">All sources</option>
          {SOURCE_TYPES.map((source) => (
            <option key={source} value={source}>
              {humanize(source)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Entries per page"
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
          className="w-auto min-w-[110px]"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </Select>
      </div>

      <div ref={tableRef} className="scroll-mt-20">
        {journal.loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : journal.error ? (
          <ErrorState message={journal.error} onRetry={() => void journal.reload()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-5 w-5" />}
            title={q || accountCode || sourceType ? 'No matching entries' : 'No journal entries'}
            body={
              q || accountCode || sourceType
                ? 'Try a different search or clear the filters.'
                : 'Postings appear automatically when bills are approved and paid, and when customer invoices are issued and collected.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-line bg-paper/30 text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Memo
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Source
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Accounts
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((entry) => {
                  const amount = entry.lines.reduce(
                    (sum, line) => sum + BigInt(line.debit),
                    0n,
                  );
                  const isOpen = expanded === entry._id;
                  const codes = entry.lines.map((line) => line.accountCode);
                  const shownCodes =
                    codes.length > 3
                      ? `${codes.slice(0, 3).join(', ')} +${codes.length - 3}`
                      : codes.join(', ');
                  return (
                    <Fragment key={entry._id}>
                      <tr
                        id={`entry-${entry._id}`}
                        tabIndex={0}
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : entry._id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setExpanded(isOpen ? null : entry._id);
                          }
                        }}
                        className={cn(
                          'cursor-pointer text-[13px] transition hover:bg-paper/60',
                          isOpen && 'bg-paper/40',
                        )}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          {formatDate(entry.date)}
                        </td>
                        <td className="max-w-[260px] px-4 py-3">
                          {entry.number ? (
                            <p className="font-num text-[11px] text-muted">{entry.number}</p>
                          ) : null}
                          <p className="truncate font-medium">{entry.memo}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-[12px] text-muted">
                              {humanize(entry.sourceType)}
                            </span>
                            <StatusPill status={entry.event} />
                          </div>
                        </td>
                        <td className="font-num whitespace-nowrap px-4 py-3 text-[12px] text-muted">
                          {shownCodes}
                        </td>
                        <td className="font-num whitespace-nowrap px-4 py-3 text-right">
                          {formatMoney(amount.toString(), entry.decimals, entry.currency)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronDown
                            className={cn(
                              'ml-auto h-4 w-4 text-muted transition',
                              isOpen && 'rotate-180',
                            )}
                          />
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="bg-paper/40">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="overflow-hidden rounded-control border border-line bg-surface">
                              <table className="w-full text-left">
                                <thead>
                                  <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                                    <th scope="col" className="px-3 py-2 font-medium">
                                      Account
                                    </th>
                                    <th scope="col" className="px-3 py-2 text-right font-medium">
                                      Debit
                                    </th>
                                    <th scope="col" className="px-3 py-2 text-right font-medium">
                                      Credit
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                  {entry.lines.map((line, index) => (
                                    <tr key={index} className="text-[12px]">
                                      <td className="px-3 py-2">
                                        <span className="font-num mr-2 text-muted">
                                          {line.accountCode}
                                        </span>
                                        {line.accountName}
                                      </td>
                                      <td className="font-num px-3 py-2 text-right">
                                        {line.debit === '0'
                                          ? '—'
                                          : formatMoney(
                                              line.debit,
                                              entry.decimals,
                                              entry.currency,
                                            )}
                                      </td>
                                      <td className="font-num px-3 py-2 text-right">
                                        {line.credit === '0'
                                          ? '—'
                                          : formatMoney(
                                              line.credit,
                                              entry.decimals,
                                              entry.currency,
                                            )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <p className="text-[12px] text-muted" aria-live="polite">
          {total === 0
            ? 'No entries'
            : `Showing ${start}–${end} of ${total} entr${total === 1 ? 'y' : 'ies'}`}
        </p>
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => goTo(page - 1)}
          >
            Previous
          </Button>
          {pageWindow(page, totalPages).map((number) => (
            <button
              key={number}
              type="button"
              onClick={() => goTo(number)}
              aria-current={number === page ? 'page' : undefined}
              className={cn(
                'h-8 min-w-8 rounded-lg px-2 text-[12px] font-medium transition',
                number === page
                  ? 'bg-ink text-white'
                  : 'text-muted hover:bg-paper hover:text-ink',
              )}
            >
              {number}
            </button>
          ))}
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => goTo(page + 1)}
          >
            Next
          </Button>
        </nav>
      </div>
    </Card>
  );
}
