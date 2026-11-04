import { applyBps, parseUnits, sumAmounts } from './money';

const QUANTITY_SCALE = 6;

export interface InvoiceLineLike {
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface ComputedInvoiceLine extends InvoiceLineLike {
  /** quantity * unitPrice in the currency's minor units, as an integer string. */
  lineTotal: string;
}

export interface InvoiceTotals {
  lines: ComputedInvoiceLine[];
  subtotal: string;
  taxAmount: string;
  total: string;
}

function lineTotal(quantity: string, unitPrice: string, decimals: number): bigint {
  // quantity is unitless (hours, units) and allowed 6dp; price is in currency units.
  const qty = parseUnits(quantity, QUANTITY_SCALE);
  const price = parseUnits(unitPrice, decimals);
  return (qty * price) / 10n ** BigInt(QUANTITY_SCALE);
}

/**
 * The single source of truth for bill / invoice totals. Both AP invoices and AR
 * receivables call this so their numbers can never drift apart.
 */
export function computeInvoiceTotals(
  lines: InvoiceLineLike[],
  decimals: number,
  taxBps: number,
): InvoiceTotals {
  const computed: ComputedInvoiceLine[] = lines.map((item) => ({
    ...item,
    lineTotal: lineTotal(item.quantity, item.unitPrice, decimals).toString(),
  }));
  const subtotal = sumAmounts(computed.map((line) => BigInt(line.lineTotal)));
  const taxAmount = applyBps(subtotal, taxBps);
  return {
    lines: computed,
    subtotal: subtotal.toString(),
    taxAmount: taxAmount.toString(),
    total: (subtotal + taxAmount).toString(),
  };
}
