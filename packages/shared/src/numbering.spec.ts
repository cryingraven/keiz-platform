import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_KINDS,
  documentPeriod,
  formatDocumentNumber,
  type DocumentKind,
} from './numbering';

describe('document numbering', () => {
  it('formats every kind with its prefix and width', () => {
    const date = new Date('2026-03-07T23:30:00Z');
    const rows: Array<[DocumentKind, string]> = [
      ['BILL', 'BIL-26/03/00001'],
      ['INVOICE', 'INV-26/03/0001'],
      ['EXPENSE', 'EXP-26/03/00001'],
      ['REVENUE', 'REV-26/03/0001'],
    ];
    for (const [kind, expected] of rows) {
      expect(formatDocumentNumber(kind, date, 1)).toBe(expected);
      expect(DOCUMENT_KINDS[kind].prefix).toBe(expected.slice(0, 3));
    }
  });

  it('pads to the configured width and never truncates', () => {
    const date = new Date('2026-11-12T00:00:00Z');
    expect(formatDocumentNumber('INVOICE', date, 42)).toBe('INV-26/11/0042');
    expect(formatDocumentNumber('INVOICE', date, 10_000)).toBe('INV-26/11/10000');
    expect(formatDocumentNumber('BILL', date, 100_000)).toBe('BIL-26/11/100000');
  });

  it('derives the month from the UTC business date', () => {
    expect(documentPeriod(new Date('2026-01-01T00:00:00Z'))).toBe('26/01');
    expect(documentPeriod(new Date('2026-12-31T23:59:59Z'))).toBe('26/12');
    // 23:30 on the last day of the month is still that month in UTC.
    expect(documentPeriod(new Date('2027-01-31T23:30:00Z'))).toBe('27/01');
    expect(documentPeriod('2026-06-15T10:00:00.000Z')).toBe('26/06');
  });

  it('rejects invalid dates and sequences', () => {
    expect(() => documentPeriod('not-a-date')).toThrow('Invalid document date');
    expect(() => formatDocumentNumber('BILL', new Date(), 0)).toThrow('positive integer');
    expect(() => formatDocumentNumber('BILL', new Date(), 1.5)).toThrow('positive integer');
  });
});
