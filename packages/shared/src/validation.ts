import { z } from 'zod';

/** Positive decimal string, no exponent, no sign, max 18dp. */
export const POSITIVE_DECIMAL_RE = /^\d+(\.\d{1,18})?$/;

export function isPositiveDecimal(value: string): boolean {
  return POSITIVE_DECIMAL_RE.test(value) && Number(value) > 0;
}

export const positiveDecimal = z
  .string()
  .min(1)
  .max(40)
  .refine(isPositiveDecimal, 'Must be a positive decimal number');

export const invoiceNumber = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Use letters, digits, dot, slash, dash or underscore');

export const NEAR_ACCOUNT_REGEX = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export type PayoutChain =
  | 'near'
  | 'eth'
  | 'base'
  | 'arb'
  | 'bsc'
  | 'polygon'
  | 'sol'
  | 'stellar'
  | 'tron'
  | 'ton';

const EVM_CHAINS = new Set(['eth', 'base', 'arb', 'bsc', 'polygon']);

/**
 * Returns an error string, or null when the address is valid for the chain.
 * Never send funds to an address that fails this check.
 */
export function validatePayoutAddress(chain: string, address: string): string | null {
  const normalized = chain.toLowerCase();
  const value = address.trim();

  if (EVM_CHAINS.has(normalized)) {
    return /^0x[a-fA-F0-9]{40}$/.test(value)
      ? null
      : 'EVM payout addresses must be 0x followed by 40 hex characters';
  }
  if (normalized === 'near') {
    if (value.length < 2 || value.length > 64 || !NEAR_ACCOUNT_REGEX.test(value)) {
      return 'Invalid NEAR account id';
    }
    return null;
  }
  if (normalized === 'sol') {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
      ? null
      : 'Invalid Solana address';
  }
  if (normalized === 'stellar') {
    return /^G[A-Z2-7]{55}$/.test(value) ? null : 'Invalid Stellar address';
  }
  if (normalized === 'tron') {
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value) ? null : 'Invalid Tron address';
  }
  if (normalized === 'ton') {
    return /^[A-Za-z0-9_-]{48}$/.test(value) ? null : 'Invalid TON address';
  }
  return `Unsupported payout chain: ${chain}`;
}

export const payoutChain = z
  .string()
  .min(2)
  .max(20)
  .transform((value) => value.toLowerCase())
  .pipe(
    z.enum(['near', 'eth', 'base', 'arb', 'bsc', 'polygon', 'sol', 'stellar', 'tron', 'ton']),
  );

/** USD-pegged assets are the only ones where EXACT_OUTPUT means "the invoice amount". */
export const USD_STABLE_SYMBOLS = ['USDC', 'USDT'] as const;
