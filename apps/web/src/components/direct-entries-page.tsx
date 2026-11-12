'use client';

import { useMemo, useState } from 'react';
import { Plus, Receipt, TrendingUp } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import {
  DirectEntryForm,
  type AccountOption,
  type DirectEntryKind,
} from '@/components/direct-entry-form';
import { Button, Card, EmptyState, ErrorState, TableSkeleton } from '@/components/ui';

interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

interface DirectEntry {
  _id: string;
  number?: string;
  date: string;
  memo: string;
  currency: string;
  decimals: number;
  lines: JournalLine[];
}

const COPY = {
  EXPENSE: {
    title: 'Direct expenses',
    description: 'Expenses paid straight from cash or bank, without a vendor bill.',
    emptyTitle: 'No direct expenses yet',
    emptyBody: 'Post an expense to debit the expense account and credit cash.',
    newLabel: 'New expense',
    path: '/accounting/expenses',
    icon: Receipt,
  },
  REVENUE: {
    title: 'Direct revenue',
    description: 'Revenue received straight into cash or bank, without a customer invoice.',
    emptyTitle: 'No direct revenue yet',
    emptyBody: 'Post revenue to debit cash and credit the revenue account.',
    newLabel: 'New revenue',
    path: '/accounting/revenues',
    icon: TrendingUp,
  },
} as const;

function pnlLine(entry: DirectEntry, kind: DirectEntryKind): JournalLine | undefined {
  return entry.lines.find((line) =>
    kind === 'EXPENSE' ? BigInt(line.debit) > 0n : BigInt(line.credit) > 0n,
  );
}

export function DirectEntriesPage({ kind }: { kind: DirectEntryKind }) {
  const copy = COPY[kind];
  const { session } = useAuth();
  const entries = useApi<DirectEntry[]>(copy.path);
  const accounts = useApi<AccountOption[]>('/accounting/accounts');
  const [formOpen, setFormOpen] = useState(false);
  const canWrite = session?.role === 'ADMIN' || session?.role === 'OWNER';
  const Icon = copy.icon;

  const rows = useMemo(() => entries.data ?? [], [entries.data]);

  return (
    <div>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          canWrite ? (
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> {copy.newLabel}
            </Button>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        {entries.loading && !entries.data ? (
          <TableSkeleton rows={5} cols={5} />
        ) : entries.error ? (
          <ErrorState message={entries.error} onRetry={() => void entries.reload()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Icon className="h-5 w-5" />}
            title={copy.emptyTitle}
            body={copy.emptyBody}
            action={
              canWrite ? (
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> {copy.newLabel}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-line md:hidden">
              {rows.map((entry) => {
                const line = pnlLine(entry, kind);
                return (
                  <li key={entry._id} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-num text-[14px] font-medium">{entry.number ?? '—'}</p>
                      <p className="truncate text-[12px] text-muted">
                        {line?.accountName ?? '—'} · {formatDate(entry.date)}
                      </p>
                      <p className="truncate text-[12px] text-muted">{entry.memo}</p>
                    </div>
                    <p className="font-num shrink-0 text-[14px]">
                      {line
                        ? formatMoney(
                            kind === 'EXPENSE' ? line.debit : line.credit,
                            entry.decimals,
                            entry.currency,
                          )
                        : '—'}
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Number</th>
                    <th className="px-5 py-3 font-medium">
                      {kind === 'EXPENSE' ? 'Expense account' : 'Revenue account'}
                    </th>
                    <th className="px-5 py-3 font-medium">Memo</th>
                    <th className="px-5 py-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((entry) => {
                    const line = pnlLine(entry, kind);
                    return (
                      <tr key={entry._id} className="transition hover:bg-paper/60">
                        <td className="px-5 py-3.5 text-[13px] text-muted">
                          {formatDate(entry.date)}
                        </td>
                        <td className="font-num px-5 py-3.5 text-[14px] font-medium">
                          {entry.number ?? '—'}
                        </td>
                        <td className="px-5 py-3.5 text-[13px] text-muted">
                          {line ? `${line.accountCode} · ${line.accountName}` : '—'}
                        </td>
                        <td className="max-w-[280px] truncate px-5 py-3.5 text-[13px] text-muted">
                          {entry.memo}
                        </td>
                        <td className="font-num px-5 py-3.5 text-right text-[14px]">
                          {line
                            ? formatMoney(
                                kind === 'EXPENSE' ? line.debit : line.credit,
                                entry.decimals,
                                entry.currency,
                              )
                            : '—'}
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

      <DirectEntryForm
        open={formOpen}
        kind={kind}
        accounts={accounts.data ?? []}
        onClose={() => setFormOpen(false)}
        onCreated={() => void entries.reload()}
      />
    </div>
  );
}
