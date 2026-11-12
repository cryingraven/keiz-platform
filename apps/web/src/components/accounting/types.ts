export interface TrialRow {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface Summary {
  currency: string;
  decimals: number;
  from: string;
  to: string;
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

export interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

export interface JournalEntry {
  _id: string;
  number?: string;
  date: string;
  memo: string;
  event: string;
  sourceType: string;
  currency: string;
  decimals: number;
  lines: JournalLine[];
}

export interface JournalPage {
  items: JournalEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Aging {
  side: string;
  currency: string;
  decimals: number;
  buckets: Array<{ key: string; label: string; count: number; amount: string }>;
  total: string;
}

export interface AccountOption {
  _id: string;
  code: string;
  name: string;
  type: string;
}

export type AccountingTab = 'overview' | 'trial-balance' | 'journal' | 'aging';

export interface DataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void | Promise<void>;
}
