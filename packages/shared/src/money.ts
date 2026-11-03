/**
 * Money is always handled as an integer in the asset's smallest unit.
 * Never use Number() on a monetary value: JS floats lose precision above 2^53.
 */

export interface Amount {
  /** Integer string in the smallest unit (e.g. "1500000" = 1.5 USDC at 6dp). */
  value: string;
  decimals: number;
}

const DECIMAL_RE = /^[+-]?\d+(\.\d+)?$/;

export function isDecimalString(input: string): boolean {
  return DECIMAL_RE.test(input.trim());
}

/** "1.5" + 6 -> 1500000n. Rejects values with more precision than the asset supports. */
export function parseUnits(input: string, decimals: number): bigint {
  const raw = input.trim();
  if (!isDecimalString(raw)) throw new Error(`Invalid decimal amount: "${input}"`);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }
  const negative = raw.startsWith('-');
  const unsigned = raw.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Amount "${input}" has more than ${decimals} decimal places`);
  }
  const padded = fraction.padEnd(decimals, '0');
  const value = BigInt(`${whole}${padded}`);
  return negative ? -value : value;
}

/** 1500000n + 6 -> "1.5". Keeps full precision, trims trailing zeros. */
export function formatUnits(value: bigint | string, decimals: number, trim = true): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  let out = whole.toString();
  if (decimals > 0) {
    let frac = fraction.toString().padStart(decimals, '0');
    if (trim) frac = frac.replace(/0+$/, '');
    if (frac.length > 0) out += `.${frac}`;
  }
  return negative ? `-${out}` : out;
}

export function toAmount(value: bigint, decimals: number): Amount {
  return { value: value.toString(), decimals };
}

export function amountToBigInt(amount: Amount): bigint {
  return BigInt(amount.value);
}

/** Multiplies an amount by basis points (100 bps = 1%). Rounds down. */
export function applyBps(value: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) throw new Error(`Invalid bps: ${bps}`);
  return (value * BigInt(bps)) / 10_000n;
}

/**
 * Converts a USD decimal string into token units using a decimal price.
 * Pure bigint math - the price is parsed at 18dp of internal precision.
 */
export function usdToUnits(usd: string, priceUsd: string, decimals: number): bigint {
  if (!isDecimalString(usd)) throw new Error(`Invalid USD amount: "${usd}"`);
  if (!isDecimalString(priceUsd)) throw new Error(`Invalid price: "${priceUsd}"`);
  const PRICE_SCALE = 18;
  const usdUnits = parseUnits(usd, PRICE_SCALE);
  const priceUnits = parseUnits(priceUsd, PRICE_SCALE);
  if (priceUnits <= 0n) throw new Error('Price must be positive');
  const tokenUnits = (usdUnits * 10n ** BigInt(decimals)) / priceUnits;
  return tokenUnits;
}

export function sumAmounts(amounts: bigint[]): bigint {
  return amounts.reduce((acc, n) => acc + n, 0n);
}
