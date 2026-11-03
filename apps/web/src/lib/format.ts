export function formatMoney(
  value: string | number,
  decimals: number,
  currency = 'USD',
): string {
  const n = Number(value) / 10 ** decimals;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

/** Formats a value that is already in major units (e.g. USD 42.5 -> $42.50). */
export function formatDollars(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export function formatCompact(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** Formats an already-formatted token amount with thousands separators. */
export function formatToken(value?: string | number): string {
  if (value === undefined || value === null || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(n);
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function shortAddress(value?: string | null, size = 5): string {
  if (!value) return '';
  if (value.length <= size * 2 + 3) return value;
  return `${value.slice(0, size)}…${value.slice(-size)}`;
}

const EXPLORER_HOSTS = [
  'nearblocks.io',
  'explorer.near.org',
  'etherscan.io',
  'basescan.org',
  'arbiscan.io',
  'bscscan.com',
  'polygonscan.com',
  'solscan.io',
  'stellar.expert',
  'tronscan.org',
];

/** Provider responses are untrusted input: only https links to known explorers. */
export function safeExplorerUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const allowed = EXPLORER_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

export function timeLeft(iso?: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const INVOICE_TONES: Record<string, string> = {
  DRAFT: 'bg-paper text-muted border-line',
  SUBMITTED: 'bg-amber-soft text-amber border-amber/20',
  APPROVED: 'bg-brand-soft text-brand-deep border-brand/20',
  REJECTED: 'bg-rose-soft text-rose border-rose/20',
  PAYMENT_PENDING: 'bg-amber-soft text-amber border-amber/20',
  PAID: 'bg-mint-soft text-mint border-mint/20',
  VOID: 'bg-paper text-muted border-line',
  AWAITING_DEPOSIT: 'bg-amber-soft text-amber border-amber/20',
  PROCESSING: 'bg-brand-soft text-brand-deep border-brand/20',
  SUCCEEDED: 'bg-mint-soft text-mint border-mint/20',
  FAILED: 'bg-rose-soft text-rose border-rose/20',
  REFUNDED: 'bg-rose-soft text-rose border-rose/20',
  UNDERPAID: 'bg-amber-soft text-amber border-amber/20',
  EXPIRED: 'bg-paper text-muted border-line',
  QUOTED: 'bg-paper text-muted border-line',
  PENDING_APPROVAL: 'bg-amber-soft text-amber border-amber/20',
  BLOCKED: 'bg-rose-soft text-rose border-rose/20',
  EXECUTED: 'bg-mint-soft text-mint border-mint/20',
  EXECUTING: 'bg-brand-soft text-brand-deep border-brand/20',
  NEEDS_REVIEW: 'bg-amber-soft text-amber border-amber/20',
};

export function toneFor(status: string): string {
  return INVOICE_TONES[status] ?? 'bg-paper text-muted border-line';
}

export function humanize(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
