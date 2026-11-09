import { describe, expect, it } from 'vitest';
import {
  agentActionCard,
  booksSummaryCard,
  describeToolCall,
  invoiceRow,
  journalListCard,
  money,
  needsConfirmation,
  receivableRow,
  spendSummaryCard,
  toolRisk,
} from './cards';

const invoice = {
  _id: 'inv-1',
  number: 'INV-1001',
  vendorId: 'ven-1',
  status: 'APPROVED',
  issueDate: '2026-01-01T00:00:00.000Z',
  dueDate: '2026-02-01T00:00:00.000Z',
  currency: 'USD',
  decimals: 2,
  subtotal: '10000',
  taxAmount: '1000',
  total: '11000',
  lineItems: [
    { description: 'Design', quantity: '1', unitPrice: '100.00', lineTotal: '10000' },
  ],
};

describe('chat card builders', () => {
  it('formats money as integer minor units plus a display value', () => {
    expect(money('11000', 2, 'USD')).toEqual({
      currency: 'USD',
      decimals: 2,
      minor: '11000',
      formatted: '110',
    });
  });

  it('builds an invoice row with a working detail link', () => {
    const row = invoiceRow(invoice, 'Acme');
    expect(row.id).toBe('inv-1');
    expect(row.vendorName).toBe('Acme');
    expect(row.total.formatted).toBe('110');
    expect(row.link.href).toBe('/dashboard/invoices/inv-1');
  });

  it('builds a spend summary card', () => {
    const card = spendSummaryCard(
      [{ _id: 'APPROVED', currency: 'USD', count: 2, total: '5000' }],
      3,
    );
    expect(card.kind).toBe('spend-summary');
    if (card.kind !== 'spend-summary') throw new Error('wrong kind');
    expect(card.data.byStatus[0].total.formatted).toBe('50');
    expect(card.data.vendorCount).toBe(3);
  });

  it('builds a books card with a balanced trial balance link', () => {
    const card = booksSummaryCard({
      currency: 'USD',
      decimals: 2,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T00:00:00.000Z',
      cash: '100',
      receivable: '200',
      payable: '50',
      inputTax: '0',
      taxPayable: '0',
      revenue: '300',
      expenses: '50',
      netIncome: '250',
      trialBalance: {
        rows: [],
        totals: { debit: '100', credit: '100', balanced: true },
      },
    });
    expect(card.kind).toBe('books-summary');
    if (card.kind !== 'books-summary') throw new Error('wrong kind');
    expect(card.data.trialBalance.totals.balanced).toBe(true);
    expect(card.link.href).toBe('/dashboard/accounting');
  });

  it('builds a receivable row with outstanding money', () => {
    const row = receivableRow(
      {
        _id: 'ar-1',
        number: 'AR-2001',
        customerId: 'cus-1',
        status: 'PARTIALLY_PAID',
        issueDate: '2026-01-01T00:00:00.000Z',
        dueDate: '2026-02-01T00:00:00.000Z',
        currency: 'USD',
        decimals: 2,
        total: '10000',
        paidAmount: '4000',
      },
      new Map([['cus-1', 'Globex']]),
    );
    expect(row.outstanding.formatted).toBe('60');
    expect(row.customerName).toBe('Globex');
    expect(row.link.href).toBe('/dashboard/receivables/ar-1');
  });

  it('builds journal and agent action cards with related links', () => {
    const journal = journalListCard([
      {
        _id: 'je-1',
        date: '2026-01-01T00:00:00.000Z',
        memo: 'Approval',
        sourceType: 'invoice',
        sourceId: 'inv-1',
        event: 'APPROVED',
        currency: 'USD',
        decimals: 2,
        lines: [
          { accountCode: '5100', debit: '100', credit: '0' },
          { accountCode: '2000', debit: '0', credit: '100' },
        ],
      },
    ]);
    expect(journal.kind).toBe('journal-list');
    if (journal.kind !== 'journal-list') throw new Error('wrong kind');
    expect(journal.data.entries[0].link.href).toBe('/dashboard/accounting?entry=je-1');

    const action = agentActionCard({
      _id: 'act-1',
      invoiceId: 'inv-1',
      status: 'APPROVED',
      asset: 'nep141:usdc.near',
      amountUsd: '125.00',
    });
    expect(action.link.href).toBe('/dashboard/invoices/inv-1');
  });
});

describe('tool summary', () => {
  it('describes risky and read-only tools', () => {
    expect(toolRisk('propose-payment')).toBe('spend');
    expect(toolRisk('list-invoices')).toBe('read');
    expect(toolRisk('unknown-tool')).toBe('write');
    expect(describeToolCall('get-invoice', { number: 'INV-1' })).toContain('INV-1');
    expect(describeToolCall('propose-payment', { invoiceNumber: 'INV-2' })).toContain('INV-2');
  });

  it('only confirms writes and drafts', () => {
    expect(needsConfirmation('list-invoices')).toBe(false);
    expect(needsConfirmation('get-invoice')).toBe(false);
    expect(needsConfirmation('booksSummary')).toBe(false);
    expect(needsConfirmation('journal-summary')).toBe(false);
    expect(needsConfirmation('propose-payment')).toBe(true);
    expect(needsConfirmation('proposePayment')).toBe(true);
    expect(needsConfirmation('some-future-tool')).toBe(true);
  });
});
