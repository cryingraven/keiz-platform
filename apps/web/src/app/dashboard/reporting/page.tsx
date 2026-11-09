'use client';

import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  FileSpreadsheet,
  Download,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { downloadApiFile } from '@/lib/download';
import { formatMoney } from '@/lib/format';
import { endOfDayIso, reportPeriodRange, startOfDayIso, defaultReportPeriod, ReportPeriod } from '@/lib/period';
import { PageHeader } from '@/components/shell';
import { ReportPeriodFilter } from '@/components/report-period-filter';
import { Button, Card, EmptyState, ErrorState, SectionTitle, Select, Spinner } from '@/components/ui';

interface ReportLine {
  code: string;
  name: string;
  amount: string;
}

interface FinancialReport {
  currency: string;
  decimals: number;
  from: string;
  to: string;
  availableCurrencies: string[];
  cashFlow: {
    inflow: string;
    outflow: string;
    net: string;
    sources: Array<{
      key: string;
      label: string;
      inflow: string;
      outflow: string;
      net: string;
    }>;
  };
  profitAndLoss: {
    revenueLines: ReportLine[];
    expenseLines: ReportLine[];
    totalRevenue: string;
    totalExpenses: string;
    netIncome: string;
  };
  balanceSheet: {
    assetLines: ReportLine[];
    liabilityLines: ReportLine[];
    equityLines: ReportLine[];
    totalAssets: string;
    totalLiabilities: string;
    totalEquity: string;
    currentEarnings: string;
    balanced: boolean;
    asOf: string;
  };
}

export default function ReportingPage() {
  const [period, setPeriod] = useState<ReportPeriod>(defaultReportPeriod);
  const [currency, setCurrency] = useState('USD');
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

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
  const money = (value: string) => formatMoney(value, data?.decimals ?? 2, data?.currency ?? currency);

  async function exportReport(format: 'pdf' | 'xlsx') {
    setExporting(format);
    setExportError(null);
    try {
      await downloadApiFile(`/accounting/reports/export?${query}&format=${format}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not export the report');
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Reporting"
        description="Cash movement, profit and loss, and the balance sheet for any period."
        actions={
          <>
            <Button
              variant="secondary"
              loading={exporting === 'pdf'}
              disabled={!data || exporting !== null}
              onClick={() => void exportReport('pdf')}
            >
              <Download className="h-3.5 w-3.5" /> Export PDF
            </Button>
            <Button
              variant="secondary"
              loading={exporting === 'xlsx'}
              disabled={!data || exporting !== null}
              onClick={() => void exportReport('xlsx')}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel
            </Button>
          </>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
        <ReportPeriodFilter value={period} onChange={setPeriod} />
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
      </Card>

      {exportError ? (
        <p className="mb-4 rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
          {exportError}
        </p>
      ) : null}

      {report.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Building the report
        </div>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat
              label="Cash in"
              value={money(data.cashFlow.inflow)}
              hint="Receipts and other cash debits"
              icon={<ArrowDownLeft className="h-4 w-4 text-mint" />}
            />
            <Stat
              label="Cash out"
              value={money(data.cashFlow.outflow)}
              hint="Vendor payments and other cash credits"
              icon={<ArrowUpRight className="h-4 w-4 text-rose" />}
            />
            <Stat
              label="Net cash"
              value={money(data.cashFlow.net)}
              hint="Cash in − cash out"
              icon={<Wallet className="h-4 w-4" />}
            />
            <Stat
              label="Revenue"
              value={money(data.profitAndLoss.totalRevenue)}
              hint="Selected period"
              icon={<TrendingUp className="h-4 w-4 text-mint" />}
            />
            <Stat
              label="Expenses"
              value={money(data.profitAndLoss.totalExpenses)}
              hint="Selected period"
              icon={<TrendingDown className="h-4 w-4 text-rose" />}
            />
            <Stat
              label="Net profit"
              value={money(data.profitAndLoss.netIncome)}
              hint="Revenue − expenses"
              tone={BigInt(data.profitAndLoss.netIncome) >= 0n ? 'text-mint' : 'text-rose'}
            />
          </div>

          <Card className="mt-5 overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <SectionTitle title="Inflow & outflow" hint="Cash movement in the selected period" />
              <span className="font-num text-[11px] text-muted">{data.currency}</span>
            </div>
            {data.cashFlow.sources.length === 0 ? (
              <p className="px-5 py-6 text-[12px] text-muted">No cash movement in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-wider text-muted">
                      <th className="px-5 py-2.5 font-medium">Source</th>
                      <th className="px-5 py-2.5 text-right font-medium">In</th>
                      <th className="px-5 py-2.5 text-right font-medium">Out</th>
                      <th className="px-5 py-2.5 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.cashFlow.sources.map((source) => (
                      <tr key={source.key} className="text-[12px]">
                        <td className="px-5 py-2.5">{source.label}</td>
                        <td className="font-num px-5 py-2.5 text-right">
                          {source.inflow === '0' ? '—' : money(source.inflow)}
                        </td>
                        <td className="font-num px-5 py-2.5 text-right">
                          {source.outflow === '0' ? '—' : money(source.outflow)}
                        </td>
                        <td className="font-num px-5 py-2.5 text-right font-medium">
                          {money(source.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line bg-paper/60 text-[12px] font-semibold">
                      <td className="px-5 py-3">Net cash</td>
                      <td className="font-num px-5 py-3 text-right">{money(data.cashFlow.inflow)}</td>
                      <td className="font-num px-5 py-3 text-right">{money(data.cashFlow.outflow)}</td>
                      <td className="font-num px-5 py-3 text-right">{money(data.cashFlow.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <SectionTitle title="Profit & loss" hint="Revenue less expenses" />
                <span className="text-[10px] uppercase tracking-wider text-muted">Period</span>
              </div>
              <div className="px-5 py-4">
                <StatementGroup title="Revenue" lines={data.profitAndLoss.revenueLines} money={money} />
                <StatementTotal label="Total revenue" value={money(data.profitAndLoss.totalRevenue)} />
                <StatementGroup title="Expenses" lines={data.profitAndLoss.expenseLines} money={money} />
                <StatementTotal label="Total expenses" value={money(data.profitAndLoss.totalExpenses)} />
                <StatementTotal
                  label="Net income"
                  value={money(data.profitAndLoss.netIncome)}
                  emphasis
                />
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <SectionTitle title="Balance sheet" hint="As of the period end" />
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    data.balanceSheet.balanced
                      ? 'bg-mint-soft text-mint'
                      : 'bg-rose-soft text-rose'
                  }`}
                >
                  {data.balanceSheet.balanced ? 'Balanced' : 'Out of balance'}
                </span>
              </div>
              <div className="px-5 py-4">
                <StatementGroup title="Assets" lines={data.balanceSheet.assetLines} money={money} />
                <StatementTotal label="Total assets" value={money(data.balanceSheet.totalAssets)} />
                <StatementGroup
                  title="Liabilities"
                  lines={data.balanceSheet.liabilityLines}
                  money={money}
                />
                <StatementTotal
                  label="Total liabilities"
                  value={money(data.balanceSheet.totalLiabilities)}
                />
                <StatementGroup title="Equity" lines={data.balanceSheet.equityLines} money={money} />
                <StatementTotal label="Total equity" value={money(data.balanceSheet.totalEquity)} />
              </div>
            </Card>
          </div>
        </>
      )}
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
    <Card className="p-4">
      <div className="flex items-center justify-between text-muted">
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
        {icon ? <span className="rounded-lg bg-paper p-1.5">{icon}</span> : null}
      </div>
      <p className={`font-num mt-2 text-[19px] font-semibold tracking-tight ${tone ?? ''}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-muted">{hint}</p>
    </Card>
  );
}

function StatementGroup({
  title,
  lines,
  money,
}: {
  title: string;
  lines: ReportLine[];
  money: (value: string) => string;
}) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted">{title}</p>
      <div className="mt-1.5 space-y-1">
        {lines.length === 0 ? (
          <p className="text-[12px] text-muted">No entries.</p>
        ) : (
          lines.map((line) => (
            <div key={`${title}-${line.code}-${line.name}`} className="flex items-center justify-between text-[12px]">
              <span className="text-muted">
                <span className="font-num mr-2 text-[10px]">{line.code}</span>
                {line.name}
              </span>
              <span className="font-num">{money(line.amount)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatementTotal({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`mb-3 flex items-center justify-between border-t border-line pt-2 text-[12px] ${
        emphasis ? 'font-semibold' : 'font-medium'
      }`}
    >
      <span>{label}</span>
      <span className="font-num">{value}</span>
    </div>
  );
}
