'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  FlaskConical,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { formatUnits } from '@keiz/shared';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatToken, safeExplorerUrl, timeLeft } from '@/lib/format';
import { Alert, Badge, Button, Card, Input, SectionTitle, Select, Spinner, StatusPill } from './ui';

interface Payment {
  _id: string;
  status: string;
  originSymbol?: string;
  originContract?: string;
  originAsset: string;
  destinationSymbol?: string;
  destinationChain?: string;
  destinationAddress?: string;
  amountIn: string;
  amountInFormatted?: string;
  amountOutFormatted?: string;
  minAmountIn?: string;
  maxAmountIn?: string;
  depositAddress?: string;
  depositMemo?: string;
  correlationId?: string;
  deadline?: string;
  txHash?: string;
  provider: string;
  outlayerRequestId?: string;
  destinationTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
  refundReason?: string;
}

interface PaymentEvent {
  _id: string;
  status: string;
  rawStatus?: string;
  createdAt: string;
}

interface Token {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
}

const TERMINAL = ['SUCCEEDED', 'FAILED', 'REFUNDED', 'UNDERPAID', 'EXPIRED', 'NEEDS_REVIEW'];

export function PayPanel({
  invoiceId,
  disabled,
  onChanged,
}: {
  invoiceId: string;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const payments = useApi<Payment[]>(`/payments?invoiceId=${invoiceId}`, { pollMs: 3000 });
  const health = useApi<{ paymentsMode: string }>('/health');
  const tokens = useApi<Token[]>('/payments/tokens');
  const { session, sendTransactions } = useAuth();
  const active = payments.data?.[0];
  const events = useApi<PaymentEvent[]>(active ? `/payments/${active._id}/events` : null, {
    pollMs: 3000,
  });

  const [creating, setCreating] = useState(false);
  const [signing, setSigning] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [originAssetId, setOriginAssetId] = useState('');
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = useMemo(() => timeLeft(active?.deadline), [active?.deadline]);
  const canAdmin = ['OWNER', 'ADMIN'].includes(session?.role ?? '');
  const isMock = (health.data?.paymentsMode ?? 'mock') === 'mock';
  const isCustody = active?.provider === 'outlayer';
  const isOpen = active ? !TERMINAL.includes(active.status) : false;

  const originTokens = (tokens.data ?? []).filter(
    (token) =>
      token.blockchain === 'near' &&
      ['USDC', 'USDT', 'WNEAR'].includes(token.symbol.toUpperCase()),
  );
  const originDecimals =
    (tokens.data ?? []).find((token) => token.assetId === active?.originAsset)?.decimals ?? 6;

  async function createQuote() {
    setCreating(true);
    setError(null);
    try {
      await api('/payments', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId,
          originAsset: originAssetId,
          slippageBps: 100,
          payer: 'USER',
          idempotencyKey: `invoice-${invoiceId}-${Date.now()}`,
        }),
      });
      await payments.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a quote');
    } finally {
      setCreating(false);
    }
  }

  async function signDeposit() {
    if (!active?.depositAddress) return;
    setSigning(true);
    setError(null);
    try {
      const contract = active.originContract ?? active.originAsset.replace(/^nep141:/, '');
      if (!contract || contract === active.originAsset) {
        throw new Error('This quote has no NEP-141 token contract');
      }

      const amount = active.amountIn;
      const isWrap = (active.originSymbol ?? '').toUpperCase() === 'WNEAR';
      const actions = isWrap
        ? [
            {
              type: 'FunctionCall',
              params: {
                methodName: 'near_deposit',
                args: {},
                gas: '30000000000000',
                deposit: amount,
              },
            },
            {
              type: 'FunctionCall',
              params: {
                methodName: 'ft_transfer',
                args: { receiver_id: active.depositAddress, amount },
                gas: '50000000000000',
                deposit: '1',
              },
            },
          ]
        : [
            {
              type: 'FunctionCall',
              params: {
                methodName: 'ft_transfer',
                args: { receiver_id: active.depositAddress, amount },
                gas: '50000000000000',
                deposit: '1',
              },
            },
          ];

      const [result] = await sendTransactions([{ receiverId: contract, actions }]);
      if (!result?.hash || result.hash.startsWith('tx-')) {
        throw new Error('Wallet did not return a transaction hash');
      }

      await api(`/payments/${active._id}/deposit`, {
        method: 'POST',
        body: JSON.stringify({ txHash: result.hash }),
      });
      await payments.reload();
      void events.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign the deposit');
    } finally {
      setSigning(false);
    }
  }

  async function submitManualHash() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/payments/${active._id}/deposit`, {
        method: 'POST',
        body: JSON.stringify({ txHash: txHash.trim() }),
      });
      setTxHash('');
      await payments.reload();
      void events.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm the deposit');
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/payments/${active._id}/simulate?status=SUCCEEDED`, { method: 'POST' });
      await new Promise((resolve) => setTimeout(resolve, 4500));
      await payments.reload();
      void events.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setBusy(false);
    }
  }

  async function cancelQuote() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/payments/${active._id}/cancel`, { method: 'POST' });
      await payments.reload();
      void events.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the quote');
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus() {
    if (!active) return;
    setBusy(true);
    try {
      await api(`/payments/${active._id}/refresh`, { method: 'POST' });
      await payments.reload();
      void events.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh');
    } finally {
      setBusy(false);
    }
  }

  const explorer = safeExplorerUrl(active?.destinationTxHashes?.[0]?.explorerUrl);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <SectionTitle
          title="Settlement"
          hint={isCustody ? 'OutLayer agent custody' : 'NEAR Intents · 1Click'}
        />
        <Badge
          className={
            isCustody
              ? 'border-brand/20 bg-brand-soft text-brand-deep'
              : isMock
                ? 'border-amber/20 bg-amber-soft text-amber'
                : 'border-rose/20 bg-rose-soft text-rose'
          }
          dot
        >
          {isCustody ? 'Custody' : isMock ? 'Mock provider' : 'Mainnet'}
        </Badge>
      </div>

      <div className="px-5 py-5">
        {isCustody ? (
          <Alert tone="info" className="mb-4">
            Paid by the agent&apos;s OutLayer custody wallet. No deposit address is needed from you;
            the TEE signs and broadcasts the transfer.
          </Alert>
        ) : isMock ? (
          <Alert tone="warning" className="mb-4">
            1Click has no testnet, so this workspace uses a deterministic mock. Deposits are not
            signed on-chain in mock mode.
          </Alert>
        ) : (
          <Alert tone="danger" className="mb-4">
            Live mainnet mode. Your wallet signs the NEP-141 deposit; funds move to the 1Click
            address. Check the amount before approving.
          </Alert>
        )}

        {!active ? (
          <>
            <dl className="space-y-2.5 text-small">
              <Row label="Vendor receives" value="Exact invoice amount in a USD stablecoin" />
              <Row label="Quote window" value="10 minutes" />
              <Row label="Deposit" value="Signed in your NEAR wallet" />
            </dl>
            {originTokens.length > 1 ? (
              <div className="mt-4">
                <p className="mb-1.5 text-small font-medium">Pay with</p>
                <Select
                  value={originAssetId}
                  onChange={(event) => setOriginAssetId(event.target.value)}
                >
                  <option value="">Default (USDC on NEAR)</option>
                  {originTokens.map((token) => (
                    <option key={token.assetId} value={token.assetId}>
                      {token.symbol} on NEAR
                    </option>
                  ))}
                </Select>
                {originAssetId &&
                originTokens.find((token) => token.assetId === originAssetId)?.symbol.toUpperCase() ===
                  'WNEAR' ? (
                  <p className="mt-1.5 text-meta text-muted">
                    wNEAR wraps native NEAR in the same transaction.
                  </p>
                ) : null}
              </div>
            ) : null}
            <Button
              className="mt-5 w-full"
              loading={creating}
              disabled={disabled}
              onClick={() => void createQuote()}
            >
              Get a quote <ArrowRight className="h-4 w-4" />
            </Button>
            {disabled ? (
              <p className="mt-2 text-center text-small text-muted">
                The bill must be approved before a quote can be locked.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-small text-muted">Vendor receives</p>
                <p className="font-num mt-1 text-[24px] font-semibold tracking-tight">
                  {formatToken(active.amountOutFormatted)}{' '}
                  <span className="text-ui font-normal text-muted">
                    {active.destinationSymbol}
                  </span>
                </p>
              </div>
              <StatusPill status={active.status} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-control bg-surface-raised px-3 py-2.5 text-small">
              <span className="font-medium">{active.originSymbol ?? 'USDC'}</span>
              <span className="text-muted">on NEAR</span>
              <ArrowRight className="h-3 w-3 text-muted" />
              <span className="font-medium">{active.destinationSymbol ?? 'USDC'}</span>
              <span className="text-muted">on {active.destinationChain ?? 'near'}</span>
              <span className="font-num ml-auto text-meta text-muted">
                payer {formatToken(active.amountInFormatted)} {active.originSymbol ?? ''}
              </span>
            </div>

            {active.minAmountIn || active.maxAmountIn ? (
              <p className="mt-2 text-meta text-muted">
                Accepted deposit range:{' '}
                <span className="font-num">
                  {active.minAmountIn ? formatUnits(active.minAmountIn, originDecimals) : '—'} –{' '}
                  {active.maxAmountIn ? formatUnits(active.maxAmountIn, originDecimals) : '—'}
                </span>
              </p>
            ) : null}

            {!isCustody && active.depositAddress ? (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-small font-medium">Deposit address</p>
                  {isOpen ? (
                    <p className="font-num text-meta text-muted">
                      {remaining === 'expired' ? 'expired' : `expires in ${remaining}`}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 rounded-control border border-line bg-surface-raised px-3 py-2.5">
                  <code className="font-num min-w-0 flex-1 truncate text-small">
                    {active.depositAddress}
                  </code>
                  <button
                    className="shrink-0 rounded p-1.5 text-muted transition hover:bg-surface hover:text-ink"
                    onClick={() => {
                      void navigator.clipboard.writeText(active.depositAddress ?? '');
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    aria-label="Copy deposit address"
                  >
                    {copied ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-mint" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                {active.depositMemo ? (
                  <p className="mt-1.5 text-small text-amber">
                    Memo required: <span className="font-num">{active.depositMemo}</span>
                  </p>
                ) : null}
              </div>
            ) : null}

            {!isCustody && active.status === 'AWAITING_DEPOSIT' ? (
              <div className="mt-4 space-y-2">
                {isMock && canAdmin ? (
                  <Button
                    size="sm"
                    className="w-full"
                    loading={busy}
                    onClick={() => void simulate()}
                  >
                    <FlaskConical className="h-3.5 w-3.5" /> Simulate settlement
                  </Button>
                ) : isMock ? (
                  <p className="rounded-control bg-surface-raised px-3 py-2 text-center text-small text-muted">
                    Ask an admin to settle this mock payment.
                  </p>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    loading={signing}
                    onClick={() => void signDeposit()}
                  >
                    <Wallet className="h-3.5 w-3.5" /> Sign deposit in wallet
                  </Button>
                )}

                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => void refreshStatus()}>
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </Button>
                  {canAdmin ? (
                    <Button size="sm" variant="ghost" loading={busy} onClick={() => void cancelQuote()}>
                      <X className="h-3.5 w-3.5" /> Cancel quote
                    </Button>
                  ) : null}
                </div>

                <details className="rounded-control border border-line px-3 py-2">
                  <summary className="cursor-pointer text-small text-muted">
                    Already sent it? Paste the transaction hash
                  </summary>
                  <div className="mt-2 flex gap-2">
                    <Input
                      placeholder="Deposit transaction hash"
                      value={txHash}
                      onChange={(event) => setTxHash(event.target.value)}
                    />
                    <Button
                      size="sm"
                      loading={busy}
                      disabled={txHash.trim().length < 8}
                      onClick={() => void submitManualHash()}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="mt-1.5 text-meta text-muted">
                    In mainnet mode the hash is verified against NEAR RPC before it is accepted.
                  </p>
                </details>
              </div>
            ) : null}

            {active.status === 'PROCESSING' ? (
              <div className="mt-4 flex items-center justify-center gap-2 rounded-control bg-brand-soft px-3 py-3 text-small text-brand-deep">
                <Spinner className="text-brand" />
                {isCustody
                  ? 'Waiting for the custody wallet to settle'
                  : 'Waiting for the verifier to settle'}
              </div>
            ) : null}

            {active.status === 'NEEDS_REVIEW' ? (
              <Alert tone="warning" className="mt-4">
                Needs manual review. The fund state is unknown, so this payment must not be retried
                automatically.
              </Alert>
            ) : null}

            {TERMINAL.includes(active.status) ? (
              <Alert
                tone={active.status === 'SUCCEEDED' ? 'success' : 'danger'}
                className="mt-4"
              >
                {active.status === 'SUCCEEDED'
                  ? 'Settled. The bill is marked paid.'
                  : `Payment ended as ${active.status.toLowerCase()}. The bill is payable again.`}
                {active.refundReason ? <p className="mt-1">Reason: {active.refundReason}</p> : null}
                {explorer ? (
                  <a
                    href={explorer}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-flex items-center gap-1 underline"
                  >
                    View on explorer <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </Alert>
            ) : null}

            {error ? (
              <Alert tone="danger" className="mt-3" onDismiss={() => setError(null)}>
                {error}
              </Alert>
            ) : null}

            {events.data && events.data.length > 0 ? (
              <div className="mt-5 border-t border-line pt-4">
                <p className="text-small font-medium">Timeline</p>
                <ol className="mt-2.5 space-y-2">
                  {events.data.map((event) => (
                    <li key={event._id} className="flex items-center gap-2.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/30" />
                      <span className="text-small">{event.status}</span>
                      <span className="font-num ml-auto text-meta text-muted">
                        {new Date(event.createdAt).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <div className="mt-3 flex items-center gap-1.5 text-meta text-muted">
              <ShieldCheck className="h-3 w-3" />
              Payout: <span className="font-num">{active.destinationAddress}</span>
            </div>

            {active.correlationId ? (
              <p className="font-num mt-2 truncate text-meta text-muted">
                quote {active.correlationId}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
