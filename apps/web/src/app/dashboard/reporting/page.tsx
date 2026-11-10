'use client';

import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, Scale, TrendingUp, Waves, type LucideIcon } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { formatDate } from '@/lib/format';
import {
  defaultReportPeriod,
  endOfDayIso,
  reportPeriodRange,
  startOfDayIso,
  type ReportPeriod,
} from '@/lib/period';
import { PageHeader } from '@/components/shell';
import { ReportPeriodFilter } from '@/components/report-period-filter';
import { ReportExportMenu } from '@/components/reports/export-menu';
import {
  BalanceSheetStatement,
  CashFlowStatement,
  ProfitLossStatement,
} from '@/components/reports/statements';
import type { FinancialReport, ReportTab } from '@/components/reports/types';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Select,
  Skeleton,
} from '@/components/ui';
import { cn } from '@/lib/utils';

const TABS: Array<{ id: ReportTab; label: string; icon: LucideIcon }> = [
  { id: 'cash-flow', label: 'Cash flow', icon: Waves },
  { id: 'profit-and-loss', label: 'Profit & loss', icon: TrendingUp },
  { id: 'balance-sheet', label: 'Balance sheet', icon: Scale },
];

function isReportTab(value: string | null): value is ReportTab {
  return TABS.some((tab) => tab.id === value);
}

function tabId(tab: ReportTab): string {
  return `report-tab-${tab}`;
}

function panelId(tab: ReportTab): string {
  return `report-panel-${tab}`;
}

export default function ReportingPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-16 animate-pulse rounded-card bg-surface" />
          <ReportSkeleton />
        </div>
      }
    >
      <ReportingContent />
    </Suspense>
  );
}

function ReportingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: ReportTab = isReportTab(tabParam) ? tabParam : 'cash-flow';
  const active = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];

  const [period, setPeriod] = useState<ReportPeriod>(defaultReportPeriod);
  const [currency, setCurrency] = useState('USD');

  const range = useMemo(() => reportPeriodRange(period), [period]);
  const query = useMemo(
    () =>
      `currency=${currency}&from=${encodeURIComponent(startOfDayIso(range.from))}&to=${encodeURIComponent(
        endOfDayIso(range.to),
      )}`,
    [currency, range.from, range.to],
  );

  const report = useApi<FinancialReport>(`/accounting/reports?${query}`);
  const data = report.data;

  function selectTab(tab: ReportTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`/dashboard/reporting?${params.toString()}`, { scroll: false });
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;

    event.preventDefault();
    const tab = TABS[next].id;
    selectTab(tab);
    document.getElementById(tabId(tab))?.focus();
  }

  const periodText = data
    ? activeTab === 'balance-sheet'
      ? `As of ${formatDate(data.to)}`
      : `${formatDate(data.from)} – ${formatDate(data.to)}`
    : '';

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Cash flow, profit & loss and the balance sheet for any period."
        actions={
          <ReportExportMenu query={query} activeTab={activeTab} disabled={!data} />
        }
      />

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
        <ReportPeriodFilter value={period} onChange={setPeriod} />
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted">Currency</span>
          <Select
            aria-label="Report currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className="w-auto min-w-[90px]"
          >
            {(data?.availableCurrencies ?? ['USD']).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <div
        role="tablist"
        aria-label="Financial reports"
        className="mb-4 flex gap-1 overflow-x-auto rounded-control border border-line bg-surface p-1 scroll-thin"
      >
        {TABS.map((tab, index) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] font-medium transition',
                selected
                  ? 'bg-ink text-white shadow-sm'
                  : 'text-muted hover:bg-paper hover:text-ink',
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {report.loading ? (
        <ReportSkeleton />
      ) : report.error ? (
        <Card>
          <ErrorState message={report.error} onRetry={() => void report.reload()} />
        </Card>
      ) : !data ? (
        <Card>
          <EmptyState
            icon={<Scale className="h-5 w-5" />}
            title="No report yet"
            body="Post a bill, invoice or manual journal entry to see the report."
          />
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-soft text-brand">
                  <active.icon className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-[16px] font-semibold tracking-tight">{active.label}</h2>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {periodText} · All amounts in {data.currency}
                  </p>
                </div>
              </div>
              {activeTab === 'balance-sheet' ? (
                <Badge
                  dot
                  className={
                    data.balanceSheet.balanced
                      ? 'border-mint/20 bg-mint-soft text-mint'
                      : 'border-rose/20 bg-rose-soft text-rose'
                  }
                >
                  {data.balanceSheet.balanced ? 'Balanced' : 'Out of balance'}
                </Badge>
              ) : (
                <span className="text-[11px] uppercase tracking-wider text-muted">Statement</span>
              )}
            </div>

            <div
              role="tabpanel"
              id={panelId(activeTab)}
              aria-labelledby={tabId(activeTab)}
              className="px-4 py-4 sm:px-5 sm:py-5"
            >
              {activeTab === 'cash-flow' ? <CashFlowStatement report={data} /> : null}
              {activeTab === 'profit-and-loss' ? <ProfitLossStatement report={data} /> : null}
              {activeTab === 'balance-sheet' ? <BalanceSheetStatement report={data} /> : null}
            </div>
          </Card>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted">
            <span>
              {activeTab === 'balance-sheet'
                ? 'The balance sheet is cumulative and reflects the position at the period end.'
                : 'This statement covers the selected period.'}
            </span>
            <Link
              href="/dashboard/accounting"
              className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
            >
              Open accounting <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <Skeleton className="h-9 w-9 rounded-control" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      <div className="space-y-4 px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-20 rounded-control" />
          <Skeleton className="h-20 rounded-control" />
          <Skeleton className="h-20 rounded-control" />
        </div>
        <Skeleton className="h-48 rounded-control" />
      </div>
    </Card>
  );
}


