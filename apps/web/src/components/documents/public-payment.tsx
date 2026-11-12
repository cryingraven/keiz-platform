'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, HandCoins, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDate, formatMoney, timeLeft } from '@/lib/format';
import { Badge, Button, Card, Input, Label, Modal, Select, Spinner } from '@/components/ui';
import type {
  PublicDocument,
  PublicPayAsset,
  PublicPayInfo,
  PublicPayQuote,
  PublicPayStatus,
} from './types';

const CHAIN_LABELS: Record<string, string> = {
  near: 'NEAR',
  eth: 'Ethereum',
  base: 'Base',
  arb: 'Arbitrum',
  sol: 'Solana',
  pol: 'Polygon',
  bsc: 'BNB Chain',
  op: 'Optimism',
  ton: 'TON',
  tron: 'Tron',
  btc: 'Bitcoin',
  stellar: 'Stellar',
  sui: 'Sui',
  avax: 'Avalanche',
};

const EVM_CHAINS = new Set([
  'eth',
  'base',
  'arb',
  'pol',
  'bsc',
  'op',
  'avax',
  'gnosis',
  'bera',
  'scroll',
  'xlayer',
  'plasma',
  'monad',
]);

function chainLabel(chain: string): string {
  return CHAIN_LABELS[chain] ?? chain.toUpperCase();
}

function refundPlaceholder(chain: string): string {
  if (!chain) return 'Select a blockchain first';
  if (chain === 'near') return 'name.near';
  if (chain === 'sol') return 'Solana address';
  if (chain === 'btc') return 'bc1…';
  if (EVM_CHAINS.has(chain)) return '0x…';
  return `Address on ${chainLabel(chain)}`;
}

const TERMINAL_FAILURES = ['FAILED', 'REFUNDED', 'UNDERPAID', 'EXPIRED', 'NEEDS_REVIEW'];

export function PublicPaymentPanel({
  token,
  document,
  onPaid,
}: {
  token: string;
  document: PublicDocument;
  onPaid: () => void;
}) {
  const payable = document.kind === 'invoice';
  const info = useApi<PublicPayInfo>(
    payable ? `/public/documents/${encodeURIComponent(token)}/pay` : null,
    { pollMs: payable ? 15_000 : undefined },
  );
  const [quote, setQuote] = useState<PublicPayQuote | null>(null);
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState('');
  const [chain, setChain] = useState('');
  const [refundTo, setRefundTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const notified = useRef<string | null>(null);
  const refreshed = useRef(false);
  const restored = useRef(false);

  const status = useApi<PublicPayStatus>(
    quote ? `/public/documents/${encodeURIComponent(token)}/pay/${quote.quoteId}` : null,
    { pollMs: 4_000 },
  );

  useEffect(() => {
    if (restored.current || !info.data?.quote) return;
    restored.current = true;
    setQuote(info.data.quote);
  }, [info.data?.quote]);

  const paid = Boolean(status.data?.paid);

  useEffect(() => {
    if (!paid || !quote || notified.current === quote.quoteId) return;
    notified.current = quote.quoteId;
    onPaid();
    void info.reload();
  }, [paid, quote, onPaid, info]);

  // A payment made elsewhere (or the indexer catching up) should also flip the
  // public document to Paid without a manual refresh.
  useEffect(() => {
    if (refreshed.current) return;
    if (info.data?.amountDue !== '0' || document.status === 'Paid') return;
    refreshed.current = true;
    onPaid();
  }, [info.data?.amountDue, document.status, onPaid]);

  const assets = info.data?.assets ?? [];
  const symbols = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.symbol))).sort(),
    [assets],
  );
  const chains = useMemo(() => {
    const seen = new Set<string>();
    return assets
      .filter((asset) => asset.symbol === currency)
      .filter((asset) => {
        if (seen.has(asset.blockchain)) return false;
        seen.add(asset.blockchain);
        return true;
      })
      .sort((a, b) => chainLabel(a.blockchain).localeCompare(chainLabel(b.blockchain)));
  }, [assets, currency]);
  const originAsset: PublicPayAsset | undefined = assets.find(
    (asset) => asset.symbol === currency && asset.blockchain === chain,
  );

  function openPay() {
    setError(null);
    setCurrency(symbols[0] ?? 'USDC');
    setChain('');
    setRefundTo('');
    setOpen(true);
  }

  async function createPayment() {
    if (!originAsset) {
      setError('Select a currency and blockchain first');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<PublicPayQuote>(
        `/public/documents/${encodeURIComponent(token)}/pay`,
        {
          method: 'POST',
          body: JSON.stringify({ originAsset: originAsset.assetId, refundTo }),
        },
      );
      setQuote(result);
      setOpen(false);
      void info.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the payment');
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy the address');
    }
  }

  if (!payable) {
    return (
      <Card className="mt-4 p-4 text-[12px] text-muted">
        This bill is settled by <span className="font-medium text-ink">{document.organizationName}</span>.
      </Card>
    );
  }

  if (info.loading) {
    return (
      <Card className="mt-4 flex items-center gap-2 p-4 text-[12px] text-muted">
        <Spinner /> Checking payment options
      </Card>
    );
  }

  if (document.status === 'Paid' || info.data?.amountDue === '0') {
    return (
      <Card className="mt-4 flex items-center gap-3 p-4">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-mint-soft text-mint">
          <Check className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[13px] font-semibold">Paid</p>
          <p className="text-[12px] text-muted">This invoice has no remaining balance.</p>
        </div>
      </Card>
    );
  }

  if (!info.data?.enabled) {
    return (
      <Card className="mt-4 p-4">
        <p className="text-[13px] font-medium">Online payment is unavailable</p>
        <p className="mt-1 text-[12px] text-muted">
          {info.data?.reason ?? info.error ?? 'Ask the sender for payment instructions.'}
        </p>
      </Card>
    );
  }

  const amountDue = info.data.amountDue ?? document.amountDue ?? '0';
  const failed = status.data ? TERMINAL_FAILURES.includes(status.data.status) : false;

  return (
    <>
      {quote ? (
        <Card className="mt-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold">Complete your payment</p>
              <p className="mt-1 text-[12px] text-muted">
                {quote.mode === 'TREASURY'
                  ? 'Your payment is delivered directly to the workspace treasury.'
                  : `Your payment is recorded on-chain against invoice ${document.number}.`}
              </p>
            </div>
            <Badge
              className={
                paid
                  ? 'border-mint/20 bg-mint-soft text-mint'
                  : failed
                    ? 'border-rose/20 bg-rose-soft text-rose'
                    : 'border-brand/20 bg-brand-soft text-brand-deep'
              }
              dot
            >
              {paid
                ? 'Paid'
                : status.data?.status === 'PROCESSING' ||
                    status.data?.status === 'SUCCEEDED'
                  ? 'Confirming'
                  : failed
                    ? 'Not completed'
                    : 'Waiting for deposit'}
            </Badge>
          </div>

          <div className="mt-3 rounded-xl border border-line bg-paper px-3 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted">Send exactly</p>
            <p className="font-num mt-1 text-[16px] font-semibold">
              {quote.amountInFormatted ?? '—'} {quote.originSymbol ?? ''}
              {quote.originChain ? (
                <span className="text-[12px] font-normal text-muted">
                  {' '}
                  on {chainLabel(quote.originChain)}
                </span>
              ) : null}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="font-num min-w-0 flex-1 truncate rounded-lg bg-surface px-2 py-1.5 text-[12px]">
                {quote.depositAddress}
              </code>
              <button
                type="button"
                onClick={() => void copy(quote.depositAddress)}
                className="rounded-lg p-1.5 text-muted transition hover:bg-surface hover:text-ink"
                aria-label="Copy deposit address"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-mint" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            {quote.depositMemo ? (
              <p className="mt-2 text-[12px] text-rose">
                Required memo: <span className="font-num">{quote.depositMemo}</span>
              </p>
            ) : null}
            <p className="mt-2 text-[11px] text-muted">
              {quote.deadline
                ? `Deposit before ${formatDate(quote.deadline)} (${timeLeft(quote.deadline)})`
                : 'Send from the same chain as the selected asset.'}
            </p>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-mint" />
              {paid ? 'Payment confirmed' : 'The invoice updates automatically once the payment lands.'}
            </span>
            {failed && !paid ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuote(null);
                  setError(null);
                  openPay();
                }}
              >
                Try again
              </Button>
            ) : null}
          </div>

          {status.data?.refundReason ? (
            <p className="mt-2 text-[11px] text-rose">Refund reason: {status.data.refundReason}</p>
          ) : null}
          {status.data?.error && !paid ? (
            <p className="mt-2 text-[11px] text-muted">{status.data.error}</p>
          ) : null}
          {quote.amountOutFormatted ? (
            <p className="mt-2 text-[11px] text-muted">
              The workspace receives {quote.amountOutFormatted}{' '}
              {quote.destinationSymbol ?? ''}
              {quote.destinationChain
                ? ` on ${chainLabel(quote.destinationChain)}`
                : ''}
              .
            </p>
          ) : null}
        </Card>
      ) : (
        <Card className="mt-4 flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-[13px] font-semibold">
              Pay {formatMoney(amountDue, document.decimals, document.currency)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              Pay from another chain with USDC or USDT.
            </p>
          </div>
          <Button onClick={openPay}>
            <HandCoins className="h-3.5 w-3.5" /> Pay invoice
          </Button>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Pay invoice"
        description="Send USDC or USDT from any supported chain. The workspace receives stablecoins on NEAR."
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="pp-currency">You pay with</Label>
              <Select
                id="pp-currency"
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value);
                  setChain('');
                  setRefundTo('');
                }}
              >
                <option value="">Select currency…</option>
                {symbols.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="pp-chain">Blockchain</Label>
              <Select
                id="pp-chain"
                value={chain}
                disabled={!currency || chains.length === 0}
                onChange={(event) => {
                  setChain(event.target.value);
                  setRefundTo('');
                }}
              >
                <option value="">{currency ? 'Select a blockchain…' : 'Select a currency first'}</option>
                {chains.map((asset) => (
                  <option key={asset.blockchain} value={asset.blockchain}>
                    {chainLabel(asset.blockchain)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="pp-refund">Refund address on the origin chain</Label>
            <Input
              id="pp-refund"
              value={refundTo}
              disabled={!chain}
              placeholder={refundPlaceholder(chain)}
              onChange={(event) => setRefundTo(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted">
              Funds return here if the swap fails. Use an address on the selected chain.
            </p>
          </div>
          {error ? (
            <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!originAsset || !refundTo.trim()}
              onClick={() => void createPayment()}
            >
              Create payment
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
