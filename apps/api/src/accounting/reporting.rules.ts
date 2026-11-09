import { AccountType, ChartAccount, signedBalance } from '@keiz/shared';

export interface RawTotals {
  debit: bigint;
  credit: bigint;
}

export interface ReportLine {
  code: string;
  name: string;
  amount: string;
}

export interface CashSourceRow {
  sourceType: string;
  event: string;
  inflow: string;
  outflow: string;
}

export interface CashFlowReport {
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
}

export interface ProfitAndLossReport {
  revenueLines: ReportLine[];
  expenseLines: ReportLine[];
  totalRevenue: string;
  totalExpenses: string;
  netIncome: string;
}

export interface BalanceSheetReport {
  assetLines: ReportLine[];
  liabilityLines: ReportLine[];
  equityLines: ReportLine[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  currentEarnings: string;
  balanced: boolean;
}

type AccountLike = Pick<ChartAccount, 'code' | 'name' | 'type' | 'normalBalance'>;

function amountFor(account: AccountLike, totals: Map<string, RawTotals>): bigint {
  return signedBalance(account.normalBalance, totals.get(account.code)?.debit ?? 0n, totals.get(account.code)?.credit ?? 0n);
}

function section(
  accounts: readonly AccountLike[],
  totals: Map<string, RawTotals>,
  type: AccountType,
): { lines: ReportLine[]; total: bigint } {
  let total = 0n;
  const lines = accounts
    .filter((account) => account.type === type)
    .map((account) => {
      const amount = amountFor(account, totals);
      total += amount;
      return { code: account.code, name: account.name, amount: amount.toString() };
    });
  return { lines, total };
}

export function buildProfitAndLoss(
  accounts: readonly AccountLike[],
  periodTotals: Map<string, RawTotals>,
): ProfitAndLossReport {
  const revenue = section(accounts, periodTotals, 'REVENUE');
  const expenses = section(accounts, periodTotals, 'EXPENSE');
  return {
    revenueLines: revenue.lines,
    expenseLines: expenses.lines,
    totalRevenue: revenue.total.toString(),
    totalExpenses: expenses.total.toString(),
    netIncome: (revenue.total - expenses.total).toString(),
  };
}

export function buildBalanceSheet(
  accounts: readonly AccountLike[],
  cumulativeTotals: Map<string, RawTotals>,
): BalanceSheetReport {
  const assets = section(accounts, cumulativeTotals, 'ASSET');
  const liabilities = section(accounts, cumulativeTotals, 'LIABILITY');
  const equity = section(accounts, cumulativeTotals, 'EQUITY');
  // There are no closing entries, so earnings not yet moved to retained
  // earnings still belong in equity. The balance sheet would not balance
  // without this line.
  const revenue = section(accounts, cumulativeTotals, 'REVENUE');
  const expenses = section(accounts, cumulativeTotals, 'EXPENSE');
  const currentEarnings = revenue.total - expenses.total;
  const equityLines = [
    ...equity.lines,
    { code: '—', name: 'Current earnings', amount: currentEarnings.toString() },
  ];
  const totalEquity = equity.total + currentEarnings;
  return {
    assetLines: assets.lines,
    liabilityLines: liabilities.lines,
    equityLines,
    totalAssets: assets.total.toString(),
    totalLiabilities: liabilities.total.toString(),
    totalEquity: totalEquity.toString(),
    currentEarnings: currentEarnings.toString(),
    balanced: assets.total === liabilities.total + totalEquity,
  };
}

const CASH_SOURCE_LABELS: Record<string, string> = {
  receipt: 'Customer receipts',
  'invoice:PAID': 'Vendor payments',
  opening: 'Opening balance',
  manual: 'Manual entries',
};

export function buildCashFlow(rows: CashSourceRow[]): CashFlowReport {
  const groups = new Map<
    string,
    { label: string; inflow: bigint; outflow: bigint }
  >();
  let inflow = 0n;
  let outflow = 0n;

  for (const row of rows) {
    const key = row.sourceType === 'invoice' ? `${row.sourceType}:${row.event}` : row.sourceType;
    const label = CASH_SOURCE_LABELS[key] ?? 'Other';
    const group = groups.get(key) ?? { label, inflow: 0n, outflow: 0n };
    group.inflow += BigInt(row.inflow);
    group.outflow += BigInt(row.outflow);
    groups.set(key, group);
    inflow += BigInt(row.inflow);
    outflow += BigInt(row.outflow);
  }

  const sources = Array.from(groups.entries())
    .filter(([, group]) => group.inflow !== 0n || group.outflow !== 0n)
    .map(([key, group]) => ({
      key,
      label: group.label,
      inflow: group.inflow.toString(),
      outflow: group.outflow.toString(),
      net: (group.inflow - group.outflow).toString(),
    }));

  return {
    inflow: inflow.toString(),
    outflow: outflow.toString(),
    net: (inflow - outflow).toString(),
    sources,
  };
}
