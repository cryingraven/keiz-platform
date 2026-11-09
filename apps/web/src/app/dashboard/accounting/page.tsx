'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download, BookOpen, RefreshCw, Scale, Wallet } from 'lucide-react';
import { formatUnits } from '@keiz/shared';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Account, ManualJournalForm } from '@/components/manual-journal-form';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SectionTitle,
  Select,
  Spinner,
} from '@/components/ui';

interface TrialRow {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  debit: string;
  credit: string;
  balance: string;
}

interface Summary {
  currency: string;
  decimals: number;
  cash: string;
  receivable: string;
  payable: string;
  inputTax: string;
  taxPayable: string;
  revenue: string;
  expenses: string;
  netIncome: string;
  availableCurrencies: string[];
  trialBalance: {
    rows: TrialRow[];
    totals: { debit: string; credit: string; balanced: boolean };
  };
}

interface JournalEntry {
  _id: string;
  date: string;
  memo: string;
  event: string;
  sourceType: string;
  currency: string;
  decimals: number;
  lines: Array<{
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
  }>;
}

interface Aging {
  side: string;
  currency: string;
  decimals: number;
  buckets: Array<{ key: string; label: string; count: number; amount: string }>;
  total: string;
}

type Range = 'month' | 'quarter' | 'year' | 'all';

function rangeStart(range: Range): Date {
  const now = new Date();
  if (range === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (range === 'quarter') {
    return new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  }
  if (range === 'year') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return new Date('2000-01-01T00:00:00Z');
}

export default function AccountingPage() {
  const searchParams = useSearchParams();
  const highlightedEntry = searchParams.get('entry');
  const [currency, setCurrency] = useState('USD');
  const [range, setRange] = useState<Range>('all');
  const [manualOpen, setManualOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { session } = useAuth();
  const canAdmin = ['ADMIN', 'OWNER'].includes(session?.role ?? 'MEMBER');

  const { summaryPath, journalPath } = useMemo(() => {
    const from = rangeStart(range);
    const to = new Date();
    to.setUTCHours(23, 59, 59, 999);
    return {
      summaryPath: `/accounting/summary?currency=${currency}&from=${encodeURIComponent(
        from.toISOString(),
      )}&to=${encodeURIComponent(to.toISOString())}`,
      journalPath: `/accounting/journal-entries?currency=${currency}&limit=50&from=${encodeURIComponent(
        from.toISOString(),
      )}&to=${encodeURIComponent(to.toISOString())}`,
    };
  }, [currency, range]);

  const summary = useApi<Summary>(summaryPath);
  const journal = useApi<JournalEntry[]>(journalPath);
  const accounts = useApi<Account[]>('/accounting/accounts');
  const apAging = useApi<Aging>(`/accounting/aging?side=AP&currency=${currency}`);
  const arAging = useApi<Aging>(`/accounting/aging?side=AR&currency=${currency}`);

  async function rebuild() {
    setRebuilding(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ created: number; failed: number }>('/accounting/rebuild', {
        method: 'POST',
      });
      setNotice(
        result.created === 0
          ? 'Ledger is already up to date.'
          : `Backfilled ${result.created} journal entr${result.created === 1 ? 'y' : 'ies'}.`,
      );
      if (result.failed > 0) setError(`${result.failed} posting(s) still failed.`);
      await Promise.all([
        summary.reload(),
        journal.reload(),
        apAging.reload(),
        arAging.reload(),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rebuild the ledger');
    } finally {
      setRebuilding(false);
    }
  }

  const data = summary.data;
  const decimals = data?.decimals ?? 2;
  const shownCurrency = data?.currency ?? currency;
  const money = (value: string) => formatMoney(value, decimals, shownCurrency);

  return (
    <div>
      <PageHeader
        title="Accounting"
        description="Double-entry books for every bill, customer invoice and receipt."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCsv(
                  'keiz-journal.csv',
                  (journal.data ?? []).flatMap((entry) =>
                    entry.lines.map((line) => ({
                      date: entry.date.slice(0, 10),
                      memo: entry.memo,
                      event: entry.event,
                      currency: entry.currency,
                      accountCode: line.accountCode,
                      accountName: line.accountName,
                      debit: formatUnits(line.debit, entry.decimals),
                      credit: formatUnits(line.credit, entry.decimals),
                    })),
                  ),
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            {canAdmin ? (
              <Button
                variant="secondary"
                loading={rebuilding}
                onClick={() => void rebuild()}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Rebuild ledger
              </Button>
            ) : null}
            {canAdmin ? (
              <Button onClick={() => setManualOpen(true)}>
                <BookOpen className="h-3.5 w-3.5" /> New journal entry
              </Button>
            ) : null}
          </>
        }
      />

      {notice ? (
        <p className="mb-4 rounded-xl border border-mint/20 bg-mint-soft px-3 py-2 text-xs text-mint">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
          {error}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={range} onChange={(event) => setRange(event.target.value as Range)}>
          <option value="month">This month</option>
          <option value="quarter">This quarter</option>
          <option value="year">This year</option>
          <option value="all">All time</option>
        </Select>
        <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
          {(data?.availableCurrencies ?? ['USD']).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
      </div>

      {summary.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading the books
        </div>
      ) : summary.error ? (
        <Card>
          <ErrorState message={summary.error} onRetry={() => void summary.reload()} />
        </Card>
      ) : !data ? (
        <Card>
          <EmptyState
            icon={<Scale className="h-5 w-5" />}
            title="No ledger yet"
            body="Approve a bill, issue a customer invoice, or post a manual entry to open the books."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Cash" value={money(data.cash)} hint="1010 · asset" icon={<Wallet className="h-4 w-4" />} />
            <Stat label="Accounts receivable" value={money(data.receivable)} hint="1100 · asset" />
            <Stat label="Accounts payable" value={money(data.payable)} hint="2000 · liability" />
            <Stat label="Revenue" value={money(data.revenue)} hint="Selected period" />
            <Stat label="Expenses" value={money(data.expenses)} hint="Selected period" />
            <Stat
              label="Net income"
              value={money(data.netIncome)}
              hint="Revenue − expenses"
              tone={BigInt(data.netIncome) >= 0n ? 'text-mint' : 'text-rose'}
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <SectionTitle title="Trial balance" hint="As of today" />
                <Badge
                  dot
                  className={
                    data.trialBalance.totals.balanced
                      ? 'border-mint/20 bg-mint-soft text-mint'
                      : 'border-rose/20 bg-rose-soft text-rose'
                  }
                >
                  {data.trialBalance.totals.balanced ? 'Balanced' : 'Out of balance'}
                </Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-wider text-muted">
                      <th className="px-5 py-2.5 font-medium">Account</th>
                      <th className="px-5 py-2.5 font-medium">Type</th>
                      <th className="px-5 py-2.5 text-right font-medium">Debit</th>
                      <th className="px-5 py-2.5 text-right font-medium">Credit</th>
                      <th className="px-5 py-2.5 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.trialBalance.rows.map((row) => (
                      <tr key={row.code}>
                        <td className="px-5 py-2.5">
                          <span className="font-num text-[11px] text-muted">{row.code}</span>
                          <span className="ml-2 text-[12px]">{row.name}</span>
                        </td>
                        <td className="px-5 py-2.5 text-[10px] uppercase tracking-wider text-muted">
                          {humanize(row.type)}
                        </td>
                        <td className="font-num px-5 py-2.5 text-right text-[12px]">
                          {row.debit === '0' ? '—' : money(row.debit)}
                        </td>
                        <td className="font-num px-5 py-2.5 text-right text-[12px]">
                          {row.credit === '0' ? '—' : money(row.credit)}
                        </td>
                        <td className="font-num px-5 py-2.5 text-right text-[12px] font-medium">
                          {money(row.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line bg-paper/60 text-[12px] font-semibold">
                      <td className="px-5 py-3" colSpan={2}>
                        Totals
                      </td>
                      <td className="font-num px-5 py-3 text-right">
                        {money(data.trialBalance.totals.debit)}
                      </td>
                      <td className="font-num px-5 py-3 text-right">
                        {money(data.trialBalance.totals.credit)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            <div className="space-y-4">
              <AgingCard title="AP aging" hint="Approved bills not yet paid" report={apAging} />
              <AgingCard title="AR aging" hint="Issued invoices not yet collected" report={arAging} />

              <Card className="p-5">
                <SectionTitle title="Balance check" hint="The ledger identity" />
                <div className="mt-3 space-y-2 text-[12px]">
                  <Row label="Assets" value={money(
                    (BigInt(data.cash) + BigInt(data.receivable) + BigInt(data.inputTax)).toString(),
                  )} />
                  <Row label="Liabilities" value={money(
                    (BigInt(data.payable) + BigInt(data.taxPayable)).toString(),
                  )} />
                  <Row label="Equity + net income" value={money(
                    (BigInt(data.cash) + BigInt(data.receivable) + BigInt(data.inputTax) -
                      BigInt(data.payable) - BigInt(data.taxPayable)).toString(),
                  )} />
                </div>
              </Card>
            </div>
          </div>

          <Card className="mt-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <SectionTitle title="Journal" hint="Newest first, append-only" />
              <span className="text-[11px] text-muted">{journal.data?.length ?? 0} entries</span>
            </div>
            {journal.loading ? (
              <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
                <Spinner /> Loading entries
              </div>
            ) : (journal.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-5 w-5" />}
                title="No journal entries"
                body="Postings appear automatically when bills are approved and paid, and when customer invoices are issued and collected."
              />
            ) : (
              <div className="divide-y divide-line">
                {journal.data?.map((entry) => {
                  // A balanced entry has equal debit and credit totals; summing
                  // both would display double the transaction value.
                  const amount = entry.lines.reduce(
                    (total, line) => total + BigInt(line.debit),
                    0n,
                  );
                  return (
                    <details
                      key={entry._id}
                      id={`entry-${entry._id}`}
                      open={highlightedEntry === entry._id}
                      className={
                        highlightedEntry === entry._id
                          ? 'group bg-brand-soft/40'
                          : 'group'
                      }
                    >
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 transition hover:bg-paper/60">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{entry.memo}</p>
                          <p className="mt-0.5 text-[10px] text-muted">
                            {formatDate(entry.date)} · {humanize(entry.sourceType)} ·{' '}
                            {humanize(entry.event)}
                          </p>
                        </div>
                        <p className="font-num text-[12px]">
                          {formatMoney(amount.toString(), entry.decimals, entry.currency)}
                        </p>
                      </summary>
                      <div className="bg-paper/40 px-5 py-3">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="text-[9px] uppercase tracking-wider text-muted">
                              <th className="pb-1 font-medium">Account</th>
                              <th className="pb-1 text-right font-medium">Debit</th>
                              <th className="pb-1 text-right font-medium">Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.lines.map((line, index) => (
                              <tr key={index} className="text-[11px]">
                                <td className="py-0.5">
                                  <span className="font-num text-muted">{line.accountCode}</span>{' '}
                                  {line.accountName}
                                </td>
                                <td className="font-num py-0.5 text-right">
                                  {line.debit === '0'
                                    ? '—'
                                    : formatMoney(line.debit, entry.decimals, entry.currency)}
                                </td>
                                <td className="font-num py-0.5 text-right">
                                  {line.credit === '0'
                                    ? '—'
                                    : formatMoney(line.credit, entry.decimals, entry.currency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}

      <ManualJournalForm
        open={manualOpen}
        accounts={accounts.data ?? []}
        onClose={() => setManualOpen(false)}
        onCreated={() => {
          void summary.reload();
          void journal.reload();
        }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon?: React.ReactNode;
  tone?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between text-muted">
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
        {icon ? <span className="rounded-lg bg-paper p-1.5">{icon}</span> : null}
      </div>
      <p className={`font-num mt-2.5 text-[22px] font-semibold tracking-tight ${tone ?? ''}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
    </Card>
  );
}

function AgingCard({
  title,
  hint,
  report,
}: {
  title: string;
  hint: string;
  report: { data: Aging | null; loading: boolean };
}) {
  const data = report.data;
  return (
    <Card className="p-5">
      <SectionTitle title={title} hint={hint} />
      {report.loading ? (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
          <Spinner /> Loading
        </div>
      ) : !data ? (
        <p className="mt-3 text-[12px] text-muted">Unavailable.</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {data.buckets.map((bucket) => (
            <div key={bucket.key} className="flex items-center justify-between text-[12px]">
              <span className="text-muted">
                {bucket.label}
                <span className="ml-1 text-[10px]">({bucket.count})</span>
              </span>
              <span className="font-num">
                {formatMoney(bucket.amount, data.decimals, data.currency)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line pt-1.5 text-[12px] font-semibold">
            <span>Total</span>
            <span className="font-num">
              {formatMoney(data.total, data.decimals, data.currency)}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-num">{value}</span>
    </div>
  );
}
