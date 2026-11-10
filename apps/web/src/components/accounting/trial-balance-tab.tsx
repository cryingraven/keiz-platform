import { Scale } from 'lucide-react';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui';
import type { DataState, Summary } from './types';

export function TrialBalanceTab({ summary }: { summary: DataState<Summary> }) {
  if (summary.loading) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="space-y-3 p-5">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
      </Card>
    );
  }
  if (summary.error) {
    return (
      <Card>
        <ErrorState message={summary.error} onRetry={() => void summary.reload()} />
      </Card>
    );
  }
  if (!summary.data) {
    return (
      <Card>
        <EmptyState
          icon={<Scale className="h-5 w-5" />}
          title="No ledger yet"
          body="Approve a bill, issue a customer invoice, or post a manual entry to open the books."
        />
      </Card>
    );
  }

  const data = summary.data;
  const money = (value: string) => formatMoney(value, data.decimals, data.currency);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">Trial balance</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            As of {formatDate(data.to)} · All amounts in {data.currency}
          </p>
        </div>
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
        <table className="w-full min-w-[620px] text-left">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
              <th scope="col" className="px-5 py-2.5 font-medium">
                Account
              </th>
              <th scope="col" className="px-5 py-2.5 font-medium">
                Type
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                Debit
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                Credit
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                Balance
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.trialBalance.rows.map((row) => (
              <tr key={row.code} className="text-[13px]">
                <td className="px-5 py-2.5">
                  <span className="font-num mr-2 text-[12px] text-muted">{row.code}</span>
                  {row.name}
                </td>
                <td className="px-5 py-2.5 text-[11px] uppercase tracking-wider text-muted">
                  {humanize(row.type)}
                </td>
                <td className="font-num px-5 py-2.5 text-right">
                  {row.debit === '0' ? '—' : money(row.debit)}
                </td>
                <td className="font-num px-5 py-2.5 text-right">
                  {row.credit === '0' ? '—' : money(row.credit)}
                </td>
                <td className="font-num px-5 py-2.5 text-right font-medium">
                  {money(row.balance)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-paper/60 text-[13px] font-semibold">
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
  );
}
