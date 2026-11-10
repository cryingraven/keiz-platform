import type { ReactNode } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  CircleDollarSign,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { formatMoney } from '@/lib/format';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  SectionTitle,
  Skeleton,
} from '@/components/ui';
import type { AccountingTab, DataState, Summary } from './types';

function MetricCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between text-muted">
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
        <span className="rounded-lg bg-paper p-1.5">{icon}</span>
      </div>
      <p className={`font-num mt-2.5 text-[22px] font-semibold tracking-tight ${tone ?? ''}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[12px] text-muted">{hint}</p>
    </Card>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[118px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-card" />
    </div>
  );
}

export function OverviewTab({
  summary,
  onOpenTab,
}: {
  summary: DataState<Summary>;
  onOpenTab: (tab: AccountingTab) => void;
}) {
  if (summary.loading) return <OverviewSkeleton />;
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
  const assets = (
    BigInt(data.cash) +
    BigInt(data.receivable) +
    BigInt(data.inputTax)
  ).toString();
  const liabilities = (BigInt(data.payable) + BigInt(data.taxPayable)).toString();
  const equity = (
    BigInt(assets) -
    BigInt(liabilities)
  ).toString();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Cash"
          value={money(data.cash)}
          hint="1010 · asset"
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label="Accounts receivable"
          value={money(data.receivable)}
          hint="1100 · asset"
          icon={<CircleDollarSign className="h-4 w-4" />}
        />
        <MetricCard
          label="Accounts payable"
          value={money(data.payable)}
          hint="2000 · liability"
          icon={<BookOpen className="h-4 w-4" />}
        />
        <MetricCard
          label="Revenue"
          value={money(data.revenue)}
          hint="Selected period"
          icon={<TrendingUp className="h-4 w-4 text-mint" />}
        />
        <MetricCard
          label="Expenses"
          value={money(data.expenses)}
          hint="Selected period"
          icon={<TrendingDown className="h-4 w-4 text-rose" />}
        />
        <MetricCard
          label="Net income"
          value={money(data.netIncome)}
          hint="Revenue minus expenses"
          tone={BigInt(data.netIncome) >= 0n ? 'text-mint' : 'text-rose'}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle title="Balance check" hint="The ledger identity" />
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
          <div className="mt-3 space-y-2 text-[13px]">
            <Row label="Assets" value={money(assets)} />
            <Row label="Liabilities" value={money(liabilities)} />
            <Row label="Equity + net income" value={money(equity)} />
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle title="Explore the books" hint="Focused views" />
          <div className="mt-3 space-y-1.5">
            {[
              ['Trial balance', 'trial-balance'],
              ['Journal entries', 'journal'],
              ['AP & AR aging', 'aging'],
            ].map(([label, tab]) => (
              <button
                key={tab}
                type="button"
                onClick={() => onOpenTab(tab as AccountingTab)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] text-muted transition hover:bg-paper hover:text-ink"
              >
                {label}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="font-num">{value}</span>
    </div>
  );
}
