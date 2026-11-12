'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Bot,
  Check,
  Copy,
  KeyRound,
  Lock,
  Play,
  Plus,
  ShieldCheck,
  Wallet as WalletIcon,
  X,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { chainNetwork } from '@/lib/network';
import { formatDollars, formatMoney, humanize, shortAddress } from '@/lib/format';
import { formatUnits } from '@keiz/shared';
import { PageHeader } from '@/components/shell';
import { AgentEconomy } from '@/components/agent-economy';
import { useConfirm, useToast } from '@/components/feedback';
import {
  NearIntentsLogo,
  NearProtocolIcon,
  OutLayerLogo,
} from '@/components/landing/logos';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Modal,
  SectionTitle,
  Select,
  Spinner,
  StatusPill,
} from '@/components/ui';

interface CustodyInfo {
  address: string;
  publicKey: string;
  nativeBalance: string;
  intentsUsdc: string;
  onChainUsdc: string;
  frozen: boolean;
  policy: Record<string, unknown> | null;
}
interface IntentsToken {
  symbol: string;
  assetId: string;
  tokenContract: string;
  decimals: number;
}
interface AgentWallet {
  _id: string;
  accountId: string;
  publicKey?: string;
  status: string;
  provider?: 'local' | 'outlayer';
  outlayerNetwork?: 'mainnet' | 'testnet';
  handoffUrl?: string | null;
  custody?: CustodyInfo | null;
  intentsUsdcToken?: IntentsToken | null;
  policy: {
    perTxLimitUsd: string;
    dailyLimitUsd: string;
    approvalThresholdUsd: string;
    allowedAssets: string[];
    active: boolean;
  };
}
interface Stats {
  spentTodayUsd: string;
  pendingApprovals: number;
  policy: AgentWallet['policy'];
  accountId: string | null;
  active: boolean;
  provider?: string | null;
  custodyAvailable?: boolean;
  custody?: CustodyInfo | null;
  intentsUsdcToken?: IntentsToken | null;
  network?: 'mainnet' | 'testnet';
}
interface SwapToken {
  tokenId: string;
  symbol: string;
  decimals: number;
  chain: string;
}
interface SwapQuote {
  nativeBalance: string;
  nativeBalanceFormatted: string;
  tokenIn: SwapToken;
  tokenOut: SwapToken;
  amountIn: string;
  amountInFormatted: string;
  amountOut?: string;
  amountOutFormatted?: string;
  minAmountOut?: string;
  minAmountOutFormatted?: string;
  deadline?: string;
}
interface SwapRequest {
  requestId: string;
  status: string;
  stage: 'wrap' | 'swap';
  amountOut?: string;
  intentHash?: string;
  approvalId?: string;
  required?: number;
  approved?: number;
}
interface SwapStatus {
  requestId: string;
  type?: string;
  status: string;
  result?: unknown;
  createdAt?: string;
  updatedAt?: string;
}
interface Action {
  _id: string;
  invoiceId: string;
  asset: string;
  amountUsd: string;
  status: string;
  reason?: string;
  paymentId?: string;
  outlayerRequestId?: string;
  outlayerApprovalId?: string;
  outlayerRequired?: number;
  outlayerApproved?: number;
  createdAt: string;
}
interface Invoice {
  _id: string;
  number: string;
  status: string;
  total: string;
  decimals: number;
}
interface Token {
  assetId: string;
  symbol: string;
  blockchain: string;
}

export default function AgentPage() {
  const wallet = useApi<AgentWallet | null>('/agent/wallet');
  const stats = useApi<Stats>('/agent/stats');
  const actions = useApi<Action[]>('/agent/actions');
  const invoices = useApi<Invoice[]>('/invoices');
  const tokens = useApi<Token[]>('/payments/tokens');
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canManagePolicy = session?.role === 'OWNER';
  const canAdmin = ['OWNER', 'ADMIN'].includes(session?.role ?? '');

  const [creating, setCreating] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapAmount, setSwapAmount] = useState('1');
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [swapRequest, setSwapRequest] = useState<SwapRequest | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const swapPoll = useApi<SwapStatus>(
    swapRequest?.requestId
      ? `/agent/wallet/swap/${encodeURIComponent(swapRequest.requestId)}`
      : null,
    { pollMs: 2_000 },
  );
  const swapStatus = swapPoll.data?.status ?? swapRequest?.status;
  const swapFinished = useRef<string | null>(null);
  const isCustody = wallet.data?.provider === 'outlayer';
  const custody = wallet.data?.custody ?? stats.data?.custody ?? null;

  const invoiceNumbers = useMemo(() => {
    const map = new Map<string, string>();
    (invoices.data ?? []).forEach((invoice) => map.set(invoice._id, invoice.number));
    return map;
  }, [invoices.data]);

  useEffect(() => {
    if (!swapRequest || !swapStatus) return;
    if (swapFinished.current === swapRequest.requestId) return;
    if (
      !['success', 'failed', 'refunded', 'pending_approval', 'rejected'].includes(
        swapStatus,
      )
    ) {
      return;
    }
    swapFinished.current = swapRequest.requestId;
    if (swapStatus === 'success') {
      toast('Swap complete');
      void wallet.reload();
      void stats.reload();
    } else if (['failed', 'refunded', 'rejected'].includes(swapStatus)) {
      setSwapError(`Swap ended as ${swapStatus}`);
    }
  }, [swapStatus, swapRequest, toast, wallet, stats]);

  async function createWallet() {
    setCreating(true);
    setError(null);
    try {
      await api('/agent/wallet', { method: 'POST' });
      await Promise.all([wallet.reload(), stats.reload()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the wallet');
    } finally {
      setCreating(false);
    }
  }

  async function enableCustody() {
    setUpgrading(true);
    setError(null);
    try {
      await api('/agent/wallet/custody', { method: 'POST' });
      await Promise.all([wallet.reload(), stats.reload()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable OutLayer custody');
    } finally {
      setUpgrading(false);
    }
  }
  async function copyUsdcContract() {
    if (!usdcToken) return;
    try {
      await navigator.clipboard.writeText(usdcToken.tokenContract);
      setCopiedToken(true);
      window.setTimeout(() => setCopiedToken(false), 1500);
    } catch {
      setError('Could not copy the USDC contract address');
    }
  }

  async function depositOnChainUsdc() {
    if (!custody || !hasOnChainUsdc) return;
    const ok = await confirm({
      title: 'Move USDC to Intents?',
      body: `Move ${onChainUsdc} USDC from the custody account into its intents.near balance so the agent can pay vendors.`,
      confirmLabel: 'Move to Intents',
    });
    if (!ok) return;
    setDepositing(true);
    setError(null);
    try {
      const result = await api<{
        requestId: string;
        status: string;
        amountFormatted: string;
      }>('/agent/wallet/intents-deposit', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (result.status === 'pending_approval') {
        toast('Approve the deposit in OutLayer', 'info');
      } else {
        toast(`Moved ${result.amountFormatted} USDC to Intents`);
      }
      await Promise.all([wallet.reload(), stats.reload()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move USDC to Intents');
    } finally {
      setDepositing(false);
    }
  }

  function openSwap() {
    setSwapOpen(true);
    setSwapQuote(null);
    setSwapRequest(null);
    setSwapError(null);
    setSwapAmount('1');
    swapFinished.current = null;
  }

  async function getSwapQuote() {
    if (!swapAmount.trim()) return;
    setSwapBusy(true);
    setSwapError(null);
    try {
      const quote = await api<SwapQuote>(
        `/agent/wallet/swap/quote?amountNear=${encodeURIComponent(swapAmount.trim())}`,
      );
      setSwapQuote(quote);
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : 'Could not quote the swap');
    } finally {
      setSwapBusy(false);
    }
  }

  async function submitSwap() {
    if (!swapQuote) return;
    setSwapBusy(true);
    setSwapError(null);
    try {
      const request = await api<SwapRequest>('/agent/wallet/swap', {
        method: 'POST',
        body: JSON.stringify({
          amountNear: swapQuote.amountInFormatted,
          minAmountOut: swapQuote.minAmountOut,
        }),
      });
      setSwapRequest(request);
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : 'Could not submit the swap');
    } finally {
      setSwapBusy(false);
    }
  }
  const nativeNear = custody ? formatUnits(custody.nativeBalance, 24) : '0';
  const intentsUsdc = custody ? formatUnits(custody.intentsUsdc, 6) : '0';
  const onChainUsdc = custody ? formatUnits(custody.onChainUsdc ?? '0', 6) : '0';
  const hasOnChainUsdc = custody
    ? BigInt(custody.onChainUsdc ?? '0') > 0n
    : false;
  const usdcToken = wallet.data?.intentsUsdcToken ?? stats.data?.intentsUsdcToken ?? null;
  const network = wallet.data?.outlayerNetwork ?? stats.data?.network ?? chainNetwork;
  const explorerBase =
    network === 'testnet' ? 'https://testnet.nearblocks.io' : 'https://nearblocks.io';

  return (
    <div>
      <PageHeader
        title="Agent wallet"
        description="Policy-bound custody for the AI agent — a TEE-held key, spending rules, and human approvals."
        actions={
          wallet.data ? (
            <div className="flex items-center gap-2">
              <Badge
                className={
                  isCustody
                    ? 'border-brand/20 bg-brand-soft text-brand-deep'
                    : wallet.data.policy.active
                      ? 'border-mint/20 bg-mint-soft text-mint'
                      : 'border-line bg-paper text-muted'
                }
                dot
              >
                {isCustody ? 'Custody' : wallet.data.policy.active ? 'Active' : 'Paused'}
              </Badge>
              <Badge className="border-line bg-paper capitalize text-muted">
                {wallet.data.outlayerNetwork ?? stats.data?.network ?? chainNetwork}
              </Badge>
            </div>
          ) : !canAdmin ? null : (
            <Button loading={creating} onClick={() => void createWallet()}>
              <Plus className="h-3.5 w-3.5" /> Create agent wallet
            </Button>
          )
        }
      />

      {error ? (
        <p className="mb-4 rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
          {error}
        </p>
      ) : null}

      {wallet.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading wallet
        </div>
      ) : wallet.error ? (
        <Card>
          <ErrorState message={wallet.error} onRetry={() => void wallet.reload()} />
        </Card>
      ) : !wallet.data ? (
        <Card>
          <EmptyState
            icon={<WalletIcon className="h-5 w-5" />}
            title="No agent wallet yet"
            body="KEIZ generates an ed25519 keypair, encrypts the secret with AES-256-GCM, and never returns it to the browser."
            action={
              canAdmin ? (
                <Button loading={creating} onClick={() => void createWallet()}>
                  Create agent wallet
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {isCustody ? (
              <>
                <Card className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] uppercase tracking-wider text-muted">Intents USDC</p>
                    {canAdmin ? (
                      <button
                        type="button"
                        onClick={openSwap}
                        className="rounded p-1 text-muted transition hover:bg-surface-raised hover:text-ink"
                        aria-label="Swap NEAR to Intents USDC"
                        title="Swap NEAR to Intents USDC"
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <p className="font-num mt-1 text-2xl font-semibold">{intentsUsdc}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                    <NearIntentsLogo className="h-3.5 w-auto" /> spendable for payouts
                  </div>
                </Card>
                <Card className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] uppercase tracking-wider text-muted">
                      On-chain USDC
                    </p>
                    {canAdmin ? (
                      <button
                        type="button"
                        onClick={() => void depositOnChainUsdc()}
                        disabled={depositing || !hasOnChainUsdc}
                        className="rounded p-1 text-muted transition hover:bg-surface-raised hover:text-ink disabled:opacity-40"
                        aria-label="Move on-chain USDC to Intents"
                        title="Move on-chain USDC to Intents"
                      >
                        {depositing ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : null}
                  </div>
                  <p className="font-num mt-1 text-2xl font-semibold">{onChainUsdc}</p>
                  <p className="mt-0.5 text-[11px] text-muted">in the custody account</p>
                </Card>
                <Card className="p-5">
                  <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted">
                    <NearProtocolIcon className="h-3 w-3" /> Native NEAR
                  </p>
                  <p className="font-num mt-1 text-2xl font-semibold">{nativeNear}</p>
                  <p className="mt-0.5 text-[11px] text-muted">gas and swaps</p>
                </Card>
                <Card className="p-5">
                  <p className="text-[11px] uppercase tracking-wider text-muted">Waiting approval</p>
                  <p className="font-num mt-1 text-2xl font-semibold">
                    {stats.data?.pendingApprovals ?? 0}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {custody?.frozen ? 'wallet frozen in OutLayer' : 'multisig / policy queue'}
                  </p>
                </Card>
              </>
            ) : (
              <>
                <Card className="p-5">
                  <p className="text-[11px] uppercase tracking-wider text-muted">Spent today</p>
                  <p className="font-num mt-1 text-2xl font-semibold">
                    {formatDollars(stats.data?.spentTodayUsd ?? '0')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    limit {formatDollars(wallet.data.policy.dailyLimitUsd)} / day
                  </p>
                </Card>
                <Card className="p-5">
                  <p className="text-[11px] uppercase tracking-wider text-muted">Daily limit</p>
                  <p className="font-num mt-1 text-2xl font-semibold">
                    {formatDollars(wallet.data.policy.dailyLimitUsd)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">per workspace day</p>
                </Card>
                <Card className="p-5">
                  <p className="text-[11px] uppercase tracking-wider text-muted">Per transaction</p>
                  <p className="font-num mt-1 text-2xl font-semibold">
                    {formatDollars(wallet.data.policy.perTxLimitUsd)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">hard block above this</p>
                </Card>
                <Card className="p-5">
                  <p className="text-[11px] uppercase tracking-wider text-muted">Auto-approve</p>
                  <p className="font-num mt-1 text-2xl font-semibold">
                    {formatDollars(wallet.data.policy.approvalThresholdUsd)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {stats.data?.pendingApprovals ?? 0} above threshold
                  </p>
                </Card>
              </>
            )}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="order-2 space-y-4">
              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <SectionTitle
                    title="Wallet"
                    hint={isCustody ? 'OutLayer TEE custody' : 'Custodied, encrypted at rest'}
                  />
                  <Badge
                    className={
                      isCustody
                        ? 'border-brand/20 bg-brand-soft text-brand-deep'
                        : wallet.data.policy.active
                          ? 'border-mint/20 bg-mint-soft text-mint'
                          : 'border-line bg-paper text-muted'
                    }
                    dot
                  >
                    {isCustody ? 'Custody' : wallet.data.policy.active ? 'Active' : 'Paused'}
                  </Badge>
                </div>
                {isCustody ? (
                  <div className="mt-3">
                    <OutLayerLogo />
                  </div>
                ) : null}
                <div className="mt-3 space-y-2.5">
                  <div className="rounded-xl bg-paper px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wider text-muted">Account</p>
                    <p className="font-num mt-0.5 truncate text-[13px]">
                      {wallet.data.accountId}
                    </p>
                  </div>
                  <div className="rounded-xl bg-paper px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wider text-muted">Public key</p>
                    <p className="font-num mt-0.5 break-all text-[12px]">
                      {shortAddress(wallet.data.publicKey ?? custody?.publicKey ?? '', 14) || '—'}
                    </p>
                  </div>
                  {isCustody ? (
                    <div className="rounded-xl bg-paper px-3 py-2.5">
                      <p className="text-[11px] uppercase tracking-wider text-muted">Network</p>
                      <p className="mt-0.5 text-[13px] font-medium capitalize">
                        {wallet.data.outlayerNetwork ?? stats.data?.network ?? 'testnet'}
                      </p>
                    </div>
                  ) : null}
                  {isCustody && usdcToken ? (
                    <div className="rounded-xl bg-paper px-3 py-2.5">
                      <p className="text-[11px] uppercase tracking-wider text-muted">
                        USDC contract
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <a
                          href={`${explorerBase}/address/${usdcToken.tokenContract}`}
                          target="_blank"
                          rel="noreferrer"
                          title={`${usdcToken.tokenContract} · ${usdcToken.assetId}`}
                          className="font-num min-w-0 truncate text-[11px] text-ink transition hover:text-brand"
                        >
                          {shortAddress(usdcToken.tokenContract, 8)}
                        </a>
                        <button
                          type="button"
                          onClick={() => void copyUsdcContract()}
                          className="shrink-0 rounded p-0.5 text-muted transition hover:text-ink"
                          aria-label="Copy USDC contract address"
                        >
                          {copiedToken ? (
                            <Check className="h-3 w-3 text-mint" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {isCustody ? (
                  <>
                    <div className="mt-3 flex gap-2 rounded-xl border border-line px-3 py-2.5 text-[11px] leading-relaxed text-muted">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        The private key lives inside an Intel TDX enclave. KEIZ stores only an
                        encrypted API key and never sees a wallet secret.
                      </span>
                    </div>
                    <div className="mt-3 rounded-xl border border-line px-3 py-2.5 text-[11px] leading-relaxed text-muted">
                      <p className="font-medium text-ink">Fund this wallet</p>
                      <p className="mt-1">
                        Send NEAR (for gas and swaps) or USDC/USDT to the custody account, or fund
                        its Intents balance from another chain in the OutLayer dashboard.
                      </p>
                    </div>
                    {wallet.data.handoffUrl ? (
                      <a
                        href={wallet.data.handoffUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-ink-soft"
                      >
                        Manage custody policy <Play className="h-3 w-3" />
                      </a>
                    ) : (
                      <p className="mt-3 text-[11px] text-muted">
                        Only the workspace owner can open the custody policy handoff.
                      </p>
                    )}
                    <p className="mt-2 text-[11px] leading-relaxed text-muted">
                      The handoff URL contains the agent API key. Open it only on a trusted device.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-3 flex gap-2 rounded-xl border border-line px-3 py-2.5 text-[11px] leading-relaxed text-muted">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        The secret is AES-256-GCM encrypted with{' '}
                        <span className="font-num">AGENT_WALLET_MASTER_KEY</span> and excluded from
                        every query by default.
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted">
                      Local mode cannot sign on-chain. Execution delegates settlement to the
                      configured payment provider; enable OutLayer custody for TEE signing.
                    </p>
                    {stats.data?.custodyAvailable && canManagePolicy ? (
                      <Button
                        className="mt-3 w-full"
                        variant="secondary"
                        size="sm"
                        loading={upgrading}
                        onClick={() => void enableCustody()}
                      >
                        Enable OutLayer custody
                      </Button>
                    ) : null}
                  </>
                )}
              </Card>

              {isCustody ? (
                <CustodyPolicyCard
                  custody={custody}
                  handoffUrl={wallet.data.handoffUrl ?? null}
                  network={wallet.data.outlayerNetwork ?? stats.data?.network ?? 'testnet'}
                />
              ) : canManagePolicy ? (
                <PolicyForm
                  wallet={wallet.data}
                  tokens={tokens.data ?? []}
                  onSaved={async () => {
                    await Promise.all([wallet.reload(), stats.reload()]);
                  }}
                />
              ) : (
                <Card className="p-5">
                  <SectionTitle title="Policy" hint="Owner-managed spending rules" />
                  <p className="mt-3 text-[13px] leading-relaxed text-muted">
                    Only the workspace owner can change agent limits. Current per-transaction limit:{' '}
                    <span className="font-num text-ink">
                      {formatDollars(wallet.data.policy.perTxLimitUsd)}
                    </span>
                    .
                  </p>
                </Card>
              )}

              <Card className="p-5">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
                  <div>
                    <p className="text-[13px] font-medium">How the leash works</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted">
                      {isCustody
                        ? 'OutLayer decrypts the on-chain policy inside Intel TDX and enforces it before every signature. Set per-transaction and velocity limits in the custody handoff before funding the wallet.'
                        : 'Proposals are checked when created and re-checked at execution. Assets outside the allowlist are blocked, and pausing the wallet blocks everything.'}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            <div className="order-1 space-y-4">
              <ProposeForm
                invoices={(invoices.data ?? []).filter((invoice) => invoice.status === 'APPROVED')}
                wallet={wallet.data}
                onCreated={async () => {
                  await Promise.all([actions.reload(), stats.reload()]);
                }}
              />

              <Card className="overflow-hidden">
                <div className="border-b border-line px-5 py-4">
                  <SectionTitle title="Agent actions" hint="Proposals, approvals, executions" />
                </div>
                {actions.loading ? (
                  <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
                    <Spinner /> Loading actions
                  </div>
                ) : (actions.data?.length ?? 0) === 0 ? (
                  <EmptyState
                    icon={<Bot className="h-5 w-5" />}
                    title="No agent actions"
                    body="Propose a payment, or ask the assistant to do it. Chat can only create proposals."
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {(actions.data ?? []).map((action) => (
                      <ActionRow
                        key={action._id}
                        action={action}
                        invoiceNumber={invoiceNumbers.get(action.invoiceId) ?? '—'}
                        onChanged={async () => {
                          await Promise.all([actions.reload(), stats.reload()]);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <AgentEconomy canAdmin={canAdmin} />
        </>
      )}

      <Modal
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        title="Swap to Intents USDC"
        description="Convert the agent's NEAR into USDC in its intents.near balance. OutLayer enforces the custody policy."
      >
        <div className="space-y-3">
          {!swapQuote ? (
            <>
              <div>
                <Label htmlFor="swap-amount">Amount (NEAR)</Label>
                <Input
                  id="swap-amount"
                  inputMode="decimal"
                  value={swapAmount}
                  placeholder="1.0"
                  onChange={(event) => setSwapAmount(event.target.value)}
                />
                <p className="mt-1 text-[11px] text-muted">
                  Available {nativeNear} NEAR. The swap keeps at least 0.1 NEAR for gas.
                </p>
              </div>
              {swapError ? (
                <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
                  {swapError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setSwapOpen(false)}>
                  Cancel
                </Button>
                <Button
                  loading={swapBusy}
                  disabled={!swapAmount.trim()}
                  onClick={() => void getSwapQuote()}
                >
                  Get quote
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2 rounded-xl border border-line bg-paper px-3 py-3 text-[13px]">
                <Row label="You pay" value={`${swapQuote.amountInFormatted} NEAR`} />
                <Row
                  label="You receive"
                  value={`~${swapQuote.amountOutFormatted ?? '—'} USDC`}
                />
                <Row
                  label="Minimum out"
                  value={`${swapQuote.minAmountOutFormatted ?? '—'} USDC`}
                />
                <Row label="Route" value="NEAR → wNEAR → Intents USDC" />
              </div>

              {swapStatus ? (
                <p
                  className={
                    swapStatus === 'success'
                      ? 'text-[12px] text-mint'
                      : ['failed', 'refunded', 'rejected'].includes(swapStatus)
                        ? 'text-[12px] text-rose'
                        : 'flex items-center gap-2 text-[12px] text-muted'
                  }
                >
                  {['processing', 'pending_deposit', 'pending_approval'].includes(swapStatus) ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : null}
                  {swapStatus === 'success'
                    ? 'Swap complete. Intents USDC will refresh in a moment.'
                    : swapStatus === 'pending_approval'
                      ? 'Waiting for OutLayer approval.'
                      : `Swap status: ${humanize(swapStatus)}`}
                </p>
              ) : null}

              {swapStatus === 'pending_approval' ? (
                wallet.data?.handoffUrl ? (
                  <a
                    href={wallet.data.handoffUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-[12px] font-medium text-brand hover:underline"
                  >
                    Open the custody handoff to approve <Play className="h-3 w-3" />
                  </a>
                ) : (
                  <p className="text-[11px] text-muted">
                    Ask the workspace owner to approve this swap in OutLayer.
                  </p>
                )
              ) : null}

              {swapStatus === 'pending_approval' ? (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={swapBusy}
                    onClick={() => {
                      setSwapRequest(null);
                      setSwapError(null);
                      swapFinished.current = null;
                      void submitSwap();
                    }}
                  >
                    Retry after approval
                  </Button>
                </div>
              ) : null}

              {swapError ? (
                <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
                  {swapError}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSwapQuote(null);
                    setSwapRequest(null);
                    setSwapError(null);
                    swapFinished.current = null;
                  }}
                >
                  Change amount
                </Button>
                <Button
                  loading={swapBusy}
                  disabled={
                    swapStatus === 'success' ||
                    swapStatus === 'pending_approval' ||
                    swapStatus === 'processing'
                  }
                  onClick={() => void submitSwap()}
                >
                  {swapStatus === 'success' ? 'Done' : 'Swap now'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

function CustodyPolicyCard({
  custody,
  handoffUrl,
  network,
}: {
  custody: CustodyInfo | null;
  handoffUrl: string | null;
  network: 'mainnet' | 'testnet';
}) {
  const policy = custody?.policy as { policy?: string; rules?: unknown } | null;
  const configured = Boolean(policy && policy.policy !== 'none');
  return (
    <Card className="p-5">
      <SectionTitle title="Custody policy" hint="Encrypted on-chain, enforced inside Intel TDX" />
      <div className="mt-4 space-y-2.5 text-[13px]">
        <Row label="Network" value={network === 'mainnet' ? 'Mainnet' : 'Testnet'} />
        <Row label="Wallet" value={custody?.frozen ? 'Frozen' : 'Active'} />
        <Row label="Rules" value={configured ? 'Configured' : 'No policy (unrestricted)'} />
      </div>
      {!configured ? (
        <p className="mt-3 rounded-xl border border-amber/20 bg-amber-soft px-3 py-2 text-[12px] leading-relaxed text-amber">
          A wallet with no policy is unrestricted inside OutLayer. Set per-transaction and daily
          limits before funding it.
        </p>
      ) : null}
      {handoffUrl ? (
        <a
          href={handoffUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline"
        >
          Open custody policy <Play className="h-3 w-3" />
        </a>
      ) : (
        <p className="mt-3 text-[12px] text-muted">
          The workspace owner can open the custody policy handoff.
        </p>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function PolicyForm({
  wallet,
  tokens,
  onSaved,
}: {
  wallet: AgentWallet;
  tokens: Token[];
  onSaved: () => Promise<void>;
}) {
  const [perTx, setPerTx] = useState(wallet.policy.perTxLimitUsd);
  const [daily, setDaily] = useState(wallet.policy.dailyLimitUsd);
  const [threshold, setThreshold] = useState(wallet.policy.approvalThresholdUsd);
  const [assets, setAssets] = useState<string[]>(wallet.policy.allowedAssets);
  const [active, setActive] = useState(wallet.policy.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const usdcTokens = tokens.filter((token) => token.symbol === 'USDC');

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('/agent/wallet/policy', {
        method: 'PATCH',
        body: JSON.stringify({
          perTxLimitUsd: perTx,
          dailyLimitUsd: daily,
          approvalThresholdUsd: threshold,
          allowedAssets: assets,
          active,
        }),
      });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save policy');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <SectionTitle title="Policy" hint="Applies immediately to new and pending actions" />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="per-tx">Per transaction (USD)</Label>
          <Input id="per-tx" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="daily">Daily (USD)</Label>
          <Input id="daily" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="threshold">Approval above (USD)</Label>
          <Input
            id="threshold"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4">
        <Label>Allowed assets</Label>
        <div className="flex flex-wrap gap-2">
          {usdcTokens.map((token) => {
            const checked = assets.includes(token.assetId);
            return (
              <button
                key={token.assetId}
                type="button"
                onClick={() =>
                  setAssets((current) =>
                    checked
                      ? current.filter((item) => item !== token.assetId)
                      : [...current, token.assetId],
                  )
                }
                className={
                  checked
                    ? 'rounded-full border border-brand/30 bg-brand-soft px-3 py-1.5 text-[12px] font-medium text-brand-deep'
                    : 'rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-muted hover:border-line-strong'
                }
              >
                USDC · {token.blockchain}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--color-brand)]"
        />
        Wallet active (unchecking is the kill switch)
      </label>

      {error ? (
        <p className="mt-3 rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-[12px] text-rose">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <Button
          size="sm"
          loading={busy}
          disabled={assets.length === 0}
          onClick={() => void save()}
        >
          Save policy
        </Button>
        {saved ? (
          <span className="text-[12px] text-mint">
            <Check className="mr-1 inline h-3 w-3" />
            saved
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function ProposeForm({
  invoices,
  wallet,
  onCreated,
}: {
  invoices: Invoice[];
  wallet: AgentWallet;
  onCreated: () => Promise<void>;
}) {
  const [invoiceId, setInvoiceId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      await api('/agent/actions', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId,
          asset: wallet.policy.allowedAssets[0] ?? 'nep141:usdc.near',
          reason: reason || undefined,
        }),
      });
      setInvoiceId('');
      setReason('');
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not propose');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <SectionTitle title="Propose a payment" hint="Only APPROVED invoices are eligible" />
      <div className="mt-3 space-y-2.5">
        <Select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
          <option value="">Select an approved invoice…</option>
          {invoices.map((invoice) => (
            <option key={invoice._id} value={invoice._id}>
              {invoice.number} · {formatMoney(invoice.total, invoice.decimals)}
            </option>
          ))}
        </Select>
        <Input
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error ? <p className="text-[12px] text-rose">{error}</p> : null}
        <Button
          size="sm"
          className="w-full"
          loading={busy}
          disabled={!invoiceId}
          onClick={() => void propose()}
        >
          <KeyRound className="h-3.5 w-3.5" /> Create proposal
        </Button>
      </div>
    </Card>
  );
}

function ActionRow({
  action,
  invoiceNumber,
  onChanged,
}: {
  action: Action;
  invoiceNumber: string;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  async function run(kind: 'approve' | 'reject' | 'execute') {
    if (kind === 'execute') {
      const ok = await confirm({
        title: 'Execute this payment?',
        body: `$${action.amountUsd} leaves the agent wallet immediately and cannot be recalled.`,
        confirmLabel: 'Execute payment',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'execute') {
        await api(`/agent/actions/${action._id}/execute`, { method: 'POST' });
      } else {
        await api(
          `/agent/actions/${action._id}/decision?decision=${kind === 'approve' ? 'APPROVE' : 'REJECT'}`,
          { method: 'POST' },
        );
      }
      await onChanged();
      toast(
        kind === 'execute'
          ? 'Payment execution started'
          : kind === 'approve'
            ? 'Proposal approved'
            : 'Proposal rejected',
        kind === 'reject' ? 'info' : 'success',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-num text-[13px] font-medium">{invoiceNumber}</p>
          <p className="truncate text-[11px] text-muted">{action.reason ?? '—'}</p>
        </div>
        <span className="font-num text-[13px]">${action.amountUsd}</span>
        <StatusPill status={action.status} />
      </div>
      {error ? <p className="mt-1.5 text-[11px] text-rose">{error}</p> : null}
      <div className="mt-2 flex items-center gap-1.5">
        {action.outlayerApprovalId ? (
          <a
            href="https://app.outlayer.ai/wallet/approvals"
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-medium text-brand hover:underline"
          >
            Approve in OutLayer ({action.outlayerApproved ?? 0}/{action.outlayerRequired ?? '?'})
          </a>
        ) : action.status === 'PENDING_APPROVAL' ? (
          <>
            <Button size="sm" loading={busy === 'approve'} onClick={() => void run('approve')}>
              <Check className="h-3 w-3" /> Approve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'reject'}
              onClick={() => void run('reject')}
            >
              <X className="h-3 w-3" /> Reject
            </Button>
          </>
        ) : null}
        {action.status === 'APPROVED' ? (
          <Button size="sm" loading={busy === 'execute'} onClick={() => void run('execute')}>
            <Play className="h-3 w-3" /> Execute
          </Button>
        ) : null}
        {action.status === 'EXECUTED' && action.paymentId ? (
          <Link
            href={`/dashboard/invoices/${action.invoiceId}`}
            className="text-[12px] font-medium text-brand hover:underline"
          >
            View settlement →
          </Link>
        ) : null}
        {action.status === 'BLOCKED' ? (
          <span className="text-[11px] text-rose">{humanize(action.status)} by policy</span>
        ) : null}
        {action.status === 'NEEDS_REVIEW' ? (
          <span className="text-[11px] text-amber">
            Needs manual review — do not retry
          </span>
        ) : null}
      </div>
    </li>
  );
}
