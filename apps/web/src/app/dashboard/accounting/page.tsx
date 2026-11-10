'use client';

import { Suspense, useMemo, useState, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BookOpen,
  Clock,
  LayoutDashboard,
  RefreshCw,
  Scale,
  type LucideIcon,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import {
  DateFilterValue,
  EMPTY_DATE_FILTER,
  dateFilterQuery,
  endOfDayIso,
  startOfDayIso,
  today,
} from '@/lib/period';
import { PageHeader } from '@/components/shell';
import { DateRangeFilter } from '@/components/date-range-filter';
import { ManualJournalForm } from '@/components/manual-journal-form';
import { OverviewTab } from '@/components/accounting/overview-tab';
import { TrialBalanceTab } from '@/components/accounting/trial-balance-tab';
import { JournalTab } from '@/components/accounting/journal-tab';
import { AgingTab } from '@/components/accounting/aging-tab';
import type {
  AccountingTab,
  AccountOption,
  Aging,
  Summary,
} from '@/components/accounting/types';
import { Button, Card, Select } from '@/components/ui';
import { cn } from '@/lib/utils';

const TABS: Array<{ id: AccountingTab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'trial-balance', label: 'Trial balance', icon: Scale },
  { id: 'journal', label: 'Journal', icon: BookOpen },
  { id: 'aging', label: 'Aging', icon: Clock },
];

function isAccountingTab(value: string | null): value is AccountingTab {
  return TABS.some((tab) => tab.id === value);
}

function tabId(tab: AccountingTab): string {
  return `accounting-tab-${tab}`;
}

function panelId(tab: AccountingTab): string {
  return `accounting-panel-${tab}`;
}

export default function AccountingPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-16 animate-pulse rounded-card bg-surface" />
          <div className="h-80 animate-pulse rounded-card bg-surface" />
        </div>
      }
    >
      <AccountingContent />
    </Suspense>
  );
}

function AccountingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightedEntry = searchParams.get('entry');
  const tabParam = searchParams.get('tab');
  const activeTab: AccountingTab = isAccountingTab(tabParam)
    ? tabParam
    : highlightedEntry
      ? 'journal'
      : 'overview';
  const active = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];

  const { session } = useAuth();
  const [currency, setCurrency] = useState(session?.org?.baseCurrency ?? 'USD');
  const [dateFilter, setDateFilter] = useState<DateFilterValue>(EMPTY_DATE_FILTER);
  const [manualOpen, setManualOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const canAdmin = ['ADMIN', 'OWNER'].includes(session?.role ?? 'MEMBER');

  const { summaryPath, journalFrom, journalTo } = useMemo(() => {
    // Accounting's default is all time. The API defaults to the current month
    // when no from/to is supplied, so make the all-time case explicit.
    const effective =
      dateFilter.preset === 'all'
        ? { ...dateFilter, from: '2000-01-01', to: today() }
        : dateFilter;
    const range = dateFilterQuery(effective, false);
    const suffix = range ? `&${range.slice(1)}` : '';
    return {
      summaryPath: `/accounting/summary?currency=${currency}${suffix}`,
      journalFrom: effective.from ? startOfDayIso(effective.from) : undefined,
      journalTo: effective.to ? endOfDayIso(effective.to) : undefined,
    };
  }, [currency, dateFilter]);

  const summary = useApi<Summary>(summaryPath);
  const accounts = useApi<AccountOption[]>('/accounting/accounts');
  const apAging = useApi<Aging>(`/accounting/aging?side=AP&currency=${currency}`);
  const arAging = useApi<Aging>(`/accounting/aging?side=AR&currency=${currency}`);

  function selectTab(tab: AccountingTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`/dashboard/accounting?${params.toString()}`, { scroll: false });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
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
      setLedgerVersion((value) => value + 1);
      await Promise.all([
        summary.reload(),
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

  return (
    <div>
      <PageHeader
        title="Accounting"
        description="Double-entry books for every bill, customer invoice and receipt."
        actions={
          <>
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

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} showDateField={false} />
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted">Currency</span>
          <Select
            aria-label="Accounting currency"
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
        aria-label="Accounting views"
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

      <div
        role="tabpanel"
        id={panelId(activeTab)}
        aria-labelledby={tabId(activeTab)}
      >
        {activeTab === 'overview' ? (
          <OverviewTab summary={summary} onOpenTab={selectTab} />
        ) : null}
        {activeTab === 'trial-balance' ? <TrialBalanceTab summary={summary} /> : null}
        {activeTab === 'journal' ? (
          <JournalTab
            currency={currency}
            from={journalFrom}
            to={journalTo}
            accounts={accounts.data ?? []}
            focusEntry={highlightedEntry}
            refreshToken={ledgerVersion}
          />
        ) : null}
        {activeTab === 'aging' ? (
          <AgingTab apAging={apAging} arAging={arAging} />
        ) : null}
      </div>

      <p className="mt-4 px-1 text-[11px] text-muted">
        {active.label} · {data ? `All amounts in ${data.currency}` : 'Double-entry ledger'}
      </p>

      <ManualJournalForm
        open={manualOpen}
        accounts={accounts.data ?? []}
        onClose={() => setManualOpen(false)}
        onCreated={() => {
          setLedgerVersion((value) => value + 1);
          void summary.reload();
          void apAging.reload();
          void arAging.reload();
        }}
      />
    </div>
  );
}
