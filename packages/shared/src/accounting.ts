export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type NormalBalance = 'debit' | 'credit';

export interface ChartAccount {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
}

/**
 * The chart of accounts every workspace gets on first posting. Codes are stable:
 * journal lines snapshot the code and name, so renaming an account never rewrites
 * history. Keep the codes in sync with `ACCOUNT_CODES`.
 */
export const CHART_OF_ACCOUNTS: readonly ChartAccount[] = [
  { code: '1010', name: 'Cash & stablecoins', type: 'ASSET', normalBalance: 'debit' },
  { code: '1100', name: 'Accounts receivable', type: 'ASSET', normalBalance: 'debit' },
  { code: '1300', name: 'Input tax recoverable', type: 'ASSET', normalBalance: 'debit' },
  { code: '2000', name: 'Accounts payable', type: 'LIABILITY', normalBalance: 'credit' },
  { code: '2100', name: 'Tax payable', type: 'LIABILITY', normalBalance: 'credit' },
  { code: '3000', name: 'Retained earnings', type: 'EQUITY', normalBalance: 'credit' },
  { code: '4000', name: 'Revenue', type: 'REVENUE', normalBalance: 'credit' },
  { code: '5100', name: 'Operating expenses', type: 'EXPENSE', normalBalance: 'debit' },
  { code: '5200', name: 'Bank & network fees', type: 'EXPENSE', normalBalance: 'debit' },
] as const;

export const ACCOUNT_CODES = {
  CASH: '1010',
  RECEIVABLE: '1100',
  INPUT_TAX: '1300',
  PAYABLE: '2000',
  TAX_PAYABLE: '2100',
  RETAINED_EARNINGS: '3000',
  REVENUE: '4000',
  OPERATING_EXPENSES: '5100',
  FEES: '5200',
} as const;

export const JOURNAL_SOURCE_TYPES = [
  'invoice',
  'receivable',
  'receipt',
  'manual',
  'opening',
] as const;
export type JournalSourceType = (typeof JOURNAL_SOURCE_TYPES)[number];

export const JOURNAL_EVENTS = [
  'APPROVED',
  'PAID',
  'VOID',
  'ISSUED',
  'RECEIVED',
  'REVERSED',
  'OPENING',
  'MANUAL',
] as const;
export type JournalEvent = (typeof JOURNAL_EVENTS)[number];

/** Where an account ends up on the statements. */
export function isDebitNormal(account: Pick<ChartAccount, 'normalBalance'>): boolean {
  return account.normalBalance === 'debit';
}

/** Signed balance in minor units: positive means the account's normal side. */
export function signedBalance(
  normalBalance: NormalBalance,
  debit: bigint,
  credit: bigint,
): bigint {
  return normalBalance === 'debit' ? debit - credit : credit - debit;
}
