import { describe, expect, it } from 'vitest';
import {
  BillForLedger,
  ReceivableForLedger,
  apApprovedLines,
  apPaidLines,
  arIssuedLines,
  arReceiptLines,
  assertBalanced,
  entryTotals,
  invertLines,
} from './accounting.rules';

const bill: BillForLedger = {
  _id: 'invoice-1',
  orgId: 'org-1',
  number: 'INV-1',
  issueDate: new Date('2026-02-01T00:00:00Z'),
  currency: 'USD',
  decimals: 2,
  subtotal: '420000',
  taxAmount: '21000',
  total: '441000',
  paidAt: new Date('2026-02-02T00:00:00Z'),
};

const receivable: ReceivableForLedger = {
  _id: 'receivable-1',
  orgId: 'org-1',
  number: 'AR-1',
  issueDate: new Date('2026-02-01T00:00:00Z'),
  currency: 'USD',
  decimals: 2,
  subtotal: '100000',
  taxAmount: '5000',
  total: '105000',
};

function line(code: string, debit: string, credit: string) {
  return { accountCode: code, debit: BigInt(debit), credit: BigInt(credit) };
}

describe('accounting posting rules', () => {
  it('posts a vendor bill as expense + input tax against AP', () => {
    const lines = apApprovedLines(bill);
    expect(lines).toContainEqual(line('5100', '420000', '0'));
    expect(lines).toContainEqual(line('1300', '21000', '0'));
    expect(lines).toContainEqual(line('2000', '0', '441000'));

    const totals = entryTotals(lines);
    expect(totals.debit).toBe(441000n);
    expect(totals.credit).toBe(441000n);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('settles AP against cash', () => {
    const lines = apPaidLines(bill);
    expect(lines).toContainEqual(line('2000', '441000', '0'));
    expect(lines).toContainEqual(line('1010', '0', '441000'));
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('omits the input tax line when there is no tax', () => {
    const lines = apApprovedLines({ ...bill, taxAmount: '0', total: '420000' });
    expect(lines.some((item) => item.accountCode === '1300')).toBe(false);
    expect(entryTotals(lines).debit).toBe(entryTotals(lines).credit);
  });

  it('inverts an entry for a void instead of editing it', () => {
    const original = apApprovedLines(bill);
    const reversal = invertLines(original);
    expect(reversal).toContainEqual(line('5100', '0', '420000'));
    expect(reversal).toContainEqual(line('1300', '0', '21000'));
    expect(reversal).toContainEqual(line('2000', '441000', '0'));
    expect(entryTotals(reversal).debit).toBe(entryTotals(reversal).credit);
  });

  it('posts an issued receivable as AR against revenue + tax', () => {
    const lines = arIssuedLines(receivable);
    expect(lines).toContainEqual(line('1100', '105000', '0'));
    expect(lines).toContainEqual(line('4000', '0', '100000'));
    expect(lines).toContainEqual(line('2100', '0', '5000'));
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('posts a receipt as cash against AR', () => {
    const lines = arReceiptLines({
      receiptId: 'receipt-1',
      amount: '50000',
      receivedAt: new Date('2026-02-03T00:00:00Z'),
    });
    expect(lines).toContainEqual(line('1010', '50000', '0'));
    expect(lines).toContainEqual(line('1100', '0', '50000'));
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('rejects an unbalanced journal', () => {
    expect(() =>
      assertBalanced([
        { debit: 100n, credit: 0n },
        { debit: 0n, credit: 90n },
      ]),
    ).toThrow(/unbalanced/);
  });

  it('rejects a zero-value journal', () => {
    expect(() => assertBalanced([{ debit: 0n, credit: 0n }])).toThrow(/no amount/);
  });
});
