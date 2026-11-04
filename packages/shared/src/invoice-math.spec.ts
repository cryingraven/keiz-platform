import { describe, expect, it } from 'vitest';
import { computeInvoiceTotals } from './invoice-math';

describe('computeInvoiceTotals', () => {
  it('keeps the existing 6-decimal quantity math', () => {
    const totals = computeInvoiceTotals(
      [{ description: 'Cloud infra', quantity: '2', unitPrice: '2100.00' }],
      2,
      500,
    );
    expect(totals.lines[0].lineTotal).toBe('420000');
    expect(totals.subtotal).toBe('420000');
    expect(totals.taxAmount).toBe('21000');
    expect(totals.total).toBe('441000');
  });

  it('supports fractional quantities and rounds tax down', () => {
    const totals = computeInvoiceTotals(
      [{ description: 'Hours', quantity: '1.5', unitPrice: '99.99' }],
      2,
      333,
    );
    // 1.5 * 99.99 = 149.985 -> 149.98 at 2dp
    expect(totals.subtotal).toBe('14998');
    expect(totals.taxAmount).toBe('499'); // 14998 * 333 / 10000 = 499.43 -> 499
    expect(totals.total).toBe('15497');
  });

  it('rejects amounts with more precision than the currency', () => {
    expect(() =>
      computeInvoiceTotals([{ description: 'Too precise', quantity: '1', unitPrice: '1.001' }], 2, 0),
    ).toThrow(/more than 2 decimal places/);
  });
});
