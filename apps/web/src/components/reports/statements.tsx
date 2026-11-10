import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { FinancialReport, ReportLine } from './types';

function moneyFor(report: FinancialReport) {
  return (value: string) => formatMoney(value, report.decimals, report.currency);
}

function ReportMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'positive' | 'negative' | 'default';
}) {
  return (
    <div className="rounded-control border border-line bg-paper/70 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</p>
      <p
        className={cn(
          'font-num mt-1.5 text-[21px] font-semibold tracking-tight',
          tone === 'positive' && 'text-mint',
          tone === 'negative' && 'text-rose',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[12px] text-muted">{hint}</p>
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-control border border-dashed border-line bg-paper/40 px-4 py-6 text-center text-[13px] text-muted">
      {children}
    </p>
  );
}

function StatementGroup({
  title,
  lines,
  money,
  emptyLabel,
}: {
  title: string;
  lines: ReportLine[];
  money: (value: string) => string;
  emptyLabel: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{title}</p>
      <div className="mt-2 space-y-1.5">
        {lines.length === 0 ? (
          <p className="py-1 text-[13px] text-muted">{emptyLabel}</p>
        ) : (
          lines.map((line) => (
            <div
              key={`${title}-${line.code}-${line.name}`}
              className="flex items-baseline justify-between gap-4 text-[13px]"
            >
              <span className="min-w-0 text-muted">
                <span className="font-num mr-2 text-[11px]">{line.code}</span>
                <span className="text-ink">{line.name}</span>
              </span>
              <span className="font-num shrink-0">{money(line.amount)}</span>
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
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 border-t border-line pt-3 text-[13px]',
        emphasis ? 'font-semibold' : 'font-medium',
      )}
    >
      <span>{label}</span>
      <span className={cn('font-num shrink-0', tone)}>{value}</span>
    </div>
  );
}

export function CashFlowStatement({ report }: { report: FinancialReport }) {
  const money = moneyFor(report);
  const net = BigInt(report.cashFlow.net);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <ReportMetric
          label="Cash in"
          value={money(report.cashFlow.inflow)}
          hint="Receipts and other cash debits"
          tone="positive"
        />
        <ReportMetric
          label="Cash out"
          value={money(report.cashFlow.outflow)}
          hint="Vendor payments and other cash credits"
          tone="negative"
        />
        <ReportMetric
          label="Net cash"
          value={money(report.cashFlow.net)}
          hint="Cash in minus cash out"
          tone={net >= 0n ? 'positive' : 'negative'}
        />
      </div>

      {report.cashFlow.sources.length === 0 ? (
        <EmptyNote>No cash movement in this period.</EmptyNote>
      ) : (
        <div className="overflow-x-auto rounded-control border border-line">
          <table className="w-full min-w-[520px] text-left">
            <thead>
              <tr className="border-b border-line bg-paper/60 text-[11px] uppercase tracking-wider text-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Source
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  In
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Out
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Net
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.cashFlow.sources.map((source) => (
                <tr key={source.key} className="text-[13px]">
                  <td className="px-4 py-2.5">{source.label}</td>
                  <td className="font-num px-4 py-2.5 text-right">
                    {source.inflow === '0' ? '—' : money(source.inflow)}
                  </td>
                  <td className="font-num px-4 py-2.5 text-right">
                    {source.outflow === '0' ? '—' : money(source.outflow)}
                  </td>
                  <td className="font-num px-4 py-2.5 text-right font-medium">
                    {money(source.net)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-paper/60 text-[13px] font-semibold">
                <td className="px-4 py-3">Net cash</td>
                <td className="font-num px-4 py-3 text-right">{money(report.cashFlow.inflow)}</td>
                <td className="font-num px-4 py-3 text-right">{money(report.cashFlow.outflow)}</td>
                <td className="font-num px-4 py-3 text-right">{money(report.cashFlow.net)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export function ProfitLossStatement({ report }: { report: FinancialReport }) {
  const money = moneyFor(report);
  const net = BigInt(report.profitAndLoss.netIncome);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <ReportMetric
          label="Revenue"
          value={money(report.profitAndLoss.totalRevenue)}
          hint="Selected period"
          tone="positive"
        />
        <ReportMetric
          label="Expenses"
          value={money(report.profitAndLoss.totalExpenses)}
          hint="Selected period"
          tone="negative"
        />
        <ReportMetric
          label="Net income"
          value={money(report.profitAndLoss.netIncome)}
          hint="Revenue minus expenses"
          tone={net >= 0n ? 'positive' : 'negative'}
        />
      </div>

      <div className="space-y-4 rounded-control border border-line p-4">
        <StatementGroup
          title="Revenue"
          lines={report.profitAndLoss.revenueLines}
          money={money}
          emptyLabel="No revenue accounts with activity in this period."
        />
        <StatementTotal
          label="Total revenue"
          value={money(report.profitAndLoss.totalRevenue)}
        />

        <StatementGroup
          title="Expenses"
          lines={report.profitAndLoss.expenseLines}
          money={money}
          emptyLabel="No expense accounts with activity in this period."
        />
        <StatementTotal
          label="Total expenses"
          value={money(report.profitAndLoss.totalExpenses)}
        />
      </div>

      <div
        className={cn(
          'flex items-center justify-between gap-4 rounded-control border px-4 py-4',
          net >= 0n ? 'border-ink bg-ink text-white' : 'border-rose/20 bg-rose-soft text-rose',
        )}
      >
        <span className="text-[14px] font-medium">Net income</span>
        <span className="font-num text-[22px] font-semibold tracking-tight">
          {money(report.profitAndLoss.netIncome)}
        </span>
      </div>
    </div>
  );
}

export function BalanceSheetStatement({ report }: { report: FinancialReport }) {
  const money = moneyFor(report);
  const liabilitiesAndEquity = (
    BigInt(report.balanceSheet.totalLiabilities) + BigInt(report.balanceSheet.totalEquity)
  ).toString();

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <ReportMetric
          label="Assets"
          value={money(report.balanceSheet.totalAssets)}
          hint="As of the period end"
        />
        <ReportMetric
          label="Liabilities"
          value={money(report.balanceSheet.totalLiabilities)}
          hint="As of the period end"
        />
        <ReportMetric
          label="Equity"
          value={money(report.balanceSheet.totalEquity)}
          hint="Including current earnings"
        />
      </div>

      <div className="grid gap-5 rounded-control border border-line p-4 xl:grid-cols-2">
        <div className="space-y-4">
          <StatementGroup
            title="Assets"
            lines={report.balanceSheet.assetLines}
            money={money}
            emptyLabel="No asset accounts."
          />
          <StatementTotal
            label="Total assets"
            value={money(report.balanceSheet.totalAssets)}
            emphasis
          />
        </div>

        <div className="space-y-4 xl:border-l xl:border-line xl:pl-5">
          <StatementGroup
            title="Liabilities"
            lines={report.balanceSheet.liabilityLines}
            money={money}
            emptyLabel="No liability accounts."
          />
          <StatementTotal
            label="Total liabilities"
            value={money(report.balanceSheet.totalLiabilities)}
          />

          <StatementGroup
            title="Equity"
            lines={report.balanceSheet.equityLines}
            money={money}
            emptyLabel="No equity accounts."
          />
          <StatementTotal
            label="Total equity"
            value={money(report.balanceSheet.totalEquity)}
          />
          <StatementTotal
            label="Total liabilities + equity"
            value={money(liabilitiesAndEquity)}
            emphasis
          />
        </div>
      </div>

      <div
        className={cn(
          'flex items-start gap-2 rounded-control border px-4 py-3 text-[13px]',
          report.balanceSheet.balanced
            ? 'border-mint/20 bg-mint-soft text-mint'
            : 'border-rose/20 bg-rose-soft text-rose',
        )}
      >
        {report.balanceSheet.balanced ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <span>
          {report.balanceSheet.balanced
            ? 'The balance sheet is in balance: assets equal liabilities plus equity.'
            : 'The balance sheet is out of balance. Check the journal entries in Accounting.'}
        </span>
      </div>
    </div>
  );
}
