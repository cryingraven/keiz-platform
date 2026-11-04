import { ACCOUNT_CODES } from '@keiz/shared';

/**
 * Pure posting rules. No Mongoose, no Nest: the service persists these lines and
 * the unit tests can cover the accounting matrix without a database.
 */

export interface PostingLine {
  accountCode: string;
  debit: bigint;
  credit: bigint;
}

export interface BillForLedger {
  _id: unknown;
  orgId: string;
  number: string;
  issueDate: Date;
  currency: string;
  decimals: number;
  subtotal: string;
  taxAmount: string;
  total: string;
  paidAt?: Date | null;
}

export interface ReceivableForLedger {
  _id: unknown;
  orgId: string;
  number: string;
  issueDate: Date;
  currency: string;
  decimals: number;
  subtotal: string;
  taxAmount: string;
  total: string;
}

export interface ReceiptForLedger {
  receiptId: string;
  amount: string;
  receivedAt: Date | string;
  currency?: string;
  decimals?: number;
}

/** Vendor bill recognised on approval: expense + input tax against AP. */
export function apApprovedLines(bill: BillForLedger): PostingLine[] {
  const tax = BigInt(bill.taxAmount);
  return [
    {
      accountCode: ACCOUNT_CODES.OPERATING_EXPENSES,
      debit: BigInt(bill.subtotal),
      credit: 0n,
    },
    ...(tax > 0n ? [{ accountCode: ACCOUNT_CODES.INPUT_TAX, debit: tax, credit: 0n }] : []),
    { accountCode: ACCOUNT_CODES.PAYABLE, debit: 0n, credit: BigInt(bill.total) },
  ];
}

/** Settlement: clear AP against cash. */
export function apPaidLines(bill: BillForLedger): PostingLine[] {
  return [
    { accountCode: ACCOUNT_CODES.PAYABLE, debit: BigInt(bill.total), credit: 0n },
    { accountCode: ACCOUNT_CODES.CASH, debit: 0n, credit: BigInt(bill.total) },
  ];
}

/** Customer invoice issued: AR against revenue + tax payable. */
export function arIssuedLines(receivable: ReceivableForLedger): PostingLine[] {
  const tax = BigInt(receivable.taxAmount);
  return [
    { accountCode: ACCOUNT_CODES.RECEIVABLE, debit: BigInt(receivable.total), credit: 0n },
    { accountCode: ACCOUNT_CODES.REVENUE, debit: 0n, credit: BigInt(receivable.subtotal) },
    ...(tax > 0n ? [{ accountCode: ACCOUNT_CODES.TAX_PAYABLE, debit: 0n, credit: tax }] : []),
  ];
}

/** Customer receipt: cash against AR. */
export function arReceiptLines(receipt: ReceiptForLedger): PostingLine[] {
  return [
    { accountCode: ACCOUNT_CODES.CASH, debit: BigInt(receipt.amount), credit: 0n },
    { accountCode: ACCOUNT_CODES.RECEIVABLE, debit: 0n, credit: BigInt(receipt.amount) },
  ];
}

/** Reverse an entry by swapping its debits and credits. */
export function invertLines(
  lines: Array<{ accountCode: string; debit: bigint; credit: bigint }>,
): PostingLine[] {
  return lines.map((line) => ({
    accountCode: line.accountCode,
    debit: line.credit,
    credit: line.debit,
  }));
}

export function entryTotals(lines: Array<Pick<PostingLine, 'debit' | 'credit'>>) {
  return lines.reduce(
    (acc, line) => ({
      debit: acc.debit + line.debit,
      credit: acc.credit + line.credit,
    }),
    { debit: 0n, credit: 0n },
  );
}

/** Throws when the entry cannot be persisted. The string is safe for tests/logs. */
export function assertBalanced(lines: Array<Pick<PostingLine, 'debit' | 'credit'>>): void {
  const totals = entryTotals(lines);
  if (totals.debit !== totals.credit) {
    throw new Error(`Journal entry is unbalanced: debits ${totals.debit} vs credits ${totals.credit}`);
  }
  if (totals.debit === 0n) {
    throw new Error('Journal entry has no amount');
  }
}
