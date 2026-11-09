import { describe, expect, it } from 'vitest';
import { CHART_OF_ACCOUNTS } from '@keiz/shared';
import {
  buildBalanceSheet,
  buildCashFlow,
  buildProfitAndLoss,
  RawTotals,
} from './reporting.rules';

function totals(values: Record<string, Partial<Record<'debit' | 'credit', string>>>) {
  const map = new Map<string, RawTotals>();
  for (const [code, value] of Object.entries(values)) {
    map.set(code, {
      debit: BigInt(value.debit ?? '0'),
      credit: BigInt(value.credit ?? '0'),
    });
  }
  return map;
}

describe('reporting rules', () => {
  it('builds a period profit and loss from revenue and expense accounts', () => {
    const report = buildProfitAndLoss(
      CHART_OF_ACCOUNTS,
      totals({
        '4000': { credit: '120000' },
        '5100': { debit: '15000' },
        '5200': { debit: '5000' },
      }),
    );

    expect(report.totalRevenue).toBe('120000');
    expect(report.totalExpenses).toBe('20000');
    expect(report.netIncome).toBe('100000');
    expect(report.revenueLines).toContainEqual({ code: '4000', name: 'Revenue', amount: '120000' });
  });

  it('balances assets against liabilities and equity plus current earnings', () => {
    const report = buildBalanceSheet(
      CHART_OF_ACCOUNTS,
      totals({
        '1010': { debit: '100000' },
        '1100': { debit: '50000' },
        '2000': { credit: '30000' },
        '3000': { credit: '20000' },
        '4000': { credit: '120000' },
        '5100': { debit: '20000' },
      }),
    );

    expect(report.totalAssets).toBe('150000');
    expect(report.totalLiabilities).toBe('30000');
    expect(report.currentEarnings).toBe('100000');
    expect(report.totalEquity).toBe('120000');
    expect(report.balanced).toBe(true);
  });

  it('classifies cash movements by source', () => {
    const report = buildCashFlow([
      { sourceType: 'receipt', event: 'RECEIVED', inflow: '60000', outflow: '0' },
      { sourceType: 'invoice', event: 'PAID', inflow: '0', outflow: '30000' },
      { sourceType: 'opening', event: 'OPENING', inflow: '20000', outflow: '0' },
    ]);

    expect(report.inflow).toBe('80000');
    expect(report.outflow).toBe('30000');
    expect(report.net).toBe('50000');
    expect(report.sources.map((source) => source.label)).toEqual([
      'Customer receipts',
      'Vendor payments',
      'Opening balance',
    ]);
  });
});
