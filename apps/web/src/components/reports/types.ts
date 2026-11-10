export interface ReportLine {
  code: string;
  name: string;
  amount: string;
}

export interface FinancialReport {
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

export type ReportTab = 'cash-flow' | 'profit-and-loss' | 'balance-sheet';
