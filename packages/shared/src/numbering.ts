/**
 * Document numbering. Every workspace keeps one monthly series per kind:
 * a bill is `BIL-YY/MM/XXXXX`, a customer invoice `INV-YY/MM/XXXX`, a direct
 * expense `EXP-YY/MM/XXXXX` and direct revenue `REV-YY/MM/XXXX`.
 *
 * The period is the document's business date in UTC, not the insert time, so
 * back-dated documents land in the right month. Padding is a minimum width:
 * sequences never wrap, they simply grow past the configured width.
 */
export const DOCUMENT_KINDS = {
  BILL: { prefix: 'BIL', digits: 5 },
  INVOICE: { prefix: 'INV', digits: 4 },
  EXPENSE: { prefix: 'EXP', digits: 5 },
  REVENUE: { prefix: 'REV', digits: 4 },
} as const;

export type DocumentKind = keyof typeof DOCUMENT_KINDS;

/** UTC `YY/MM` period used by both the number and the counter document. */
export function documentPeriod(date: Date | string): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) throw new Error('Invalid document date');
  const year = String(value.getUTCFullYear()).slice(-2).padStart(2, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}`;
}

export function formatDocumentNumber(
  kind: DocumentKind,
  date: Date | string,
  sequence: number,
): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('Document sequence must be a positive integer');
  }
  const { prefix, digits } = DOCUMENT_KINDS[kind];
  return `${prefix}-${documentPeriod(date)}/${String(sequence).padStart(digits, '0')}`;
}
