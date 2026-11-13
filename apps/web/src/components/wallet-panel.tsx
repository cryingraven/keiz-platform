'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Send,
  Wallet,
} from 'lucide-react';
import { formatUnits, type WalletOverview, type WalletRecipient } from '@keiz/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { shortAddress } from '@/lib/format';
import { chainNetwork } from '@/lib/network';
import {
  buildTransferTransactions,
  buildWalletAssets,
  explorerAccountUrl,
  explorerTxUrl,
  formatAssetAmount,
  maxSendable,
  validateTransfer,
  type WalletAsset,
} from '@/lib/wallet';
import { Alert, Badge, Button, Field, Input, Modal, Select, Spinner } from './ui';

type Step = 'balances' | 'send' | 'review' | 'sent';

export function WalletPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, sendTransactions } = useAuth();
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Wallet balances are cache-busted on every open and manual refresh. The
  // nonce also makes `useApi` reload when the number changes.
  const overview = useApi<WalletOverview>(
    open ? `/wallet?refresh=1&nonce=${refreshNonce}` : null,
  );
  const [step, setStep] = useState<Step>('balances');
  const [assetKey, setAssetKey] = useState('near');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [recipientInfo, setRecipientInfo] = useState<WalletRecipient | null>(null);
  const [registerStorage, setRegisterStorage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState(false);

  const assets = useMemo(
    () => (overview.data ? buildWalletAssets(overview.data) : []),
    [overview.data],
  );
  const asset = assets.find((item) => item.key === assetKey) ?? assets[0];

  useEffect(() => {
    if (open) return;
    setStep('balances');
    setAssetKey('near');
    setRecipient('');
    setAmount('');
    setRecipientInfo(null);
    setRegisterStorage(false);
    setBusy(false);
    setError(null);
    setTxHash('');
    setCopied(false);
  }, [open]);

  const accountId = overview.data?.accountId ?? session?.user?.accountId ?? '';
  const network = overview.data?.network ?? chainNetwork;

  function refresh() {
    setRefreshNonce((value) => value + 1);
  }

  async function copyAddress() {
    if (!accountId) return;
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the address. Select it and copy manually.');
    }
  }

  function startSend(next: WalletAsset) {
    setAssetKey(next.key);
    setAmount('');
    setRecipient('');
    setRecipientInfo(null);
    setRegisterStorage(false);
    setError(null);
    setStep('send');
  }

  function useMax() {
    if (!asset) return;
    setAmount(formatUnits(maxSendable(asset), asset.decimals));
    setError(null);
  }

  async function review() {
    if (!asset) return;
    const message = validateTransfer({ asset, recipient, amount });
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const contractId =
        asset.kind === 'token'
          ? asset.contractId
          : asset.kind === 'intents'
            ? asset.tokenContract
            : null;
      const query = contractId ? `?contractId=${encodeURIComponent(contractId)}` : '';
      const info = await api<WalletRecipient>(
        `/wallet/recipient/${encodeURIComponent(recipient.trim())}${query}`,
      );
      // Implicit accounts are valid before they exist on-chain: a NEAR transfer
      // can create them. A missing named account is almost always a typo.
      const implicit = /^[0-9a-f]{64}$/.test(info.accountId);
      if (!info.exists && !implicit) {
        setError('That account does not exist on-chain. Check the address before sending.');
        return;
      }
      setRecipientInfo(info);
      setRegisterStorage(
        (asset.kind === 'token' || asset.kind === 'intents') && info.registered === false,
      );
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the recipient');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!asset) return;
    const nativeBalance = overview.data?.near.available;
    const message = validateTransfer({ asset, recipient, amount, registerStorage, nativeBalance });
    if (message) {
      setError(message);
      setStep('send');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const results = await sendTransactions(
        buildTransferTransactions({
          asset,
          recipient,
          amount,
          registerStorage,
          nativeBalance,
          storageDeposit: recipientInfo?.requiredStorageDeposit ?? undefined,
        }),
      );
      // Intents withdrawals can include a storage_deposit transaction first.
      const result = results[results.length - 1];
      if (!result?.hash || result.hash.startsWith('tx-')) {
        throw new Error('The wallet did not return a transaction hash');
      }
      setTxHash(result.hash);
      setStep('sent');
      window.setTimeout(refresh, 2500);
    } catch (err) {
      setError(friendlyTransferError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Wallet"
      description="Your personal NEAR account. Transfers are signed by you and never touch the ledger."
    >
      <div className="space-y-4">
        {accountId ? (
          <div className="rounded-control border border-line bg-surface-raised px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-meta text-muted">Signed in as</p>
              {overview.data ? (
                <Badge
                  className={
                    network === 'mainnet'
                      ? 'border-brand/20 bg-brand-soft text-brand-deep'
                      : 'border-amber/20 bg-amber-soft text-amber'
                  }
                  dot
                >
                  NEAR {network}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <p className="font-num min-w-0 flex-1 break-all text-small font-medium">
                {accountId}
              </p>
              <button
                type="button"
                onClick={() => void copyAddress()}
                className="rounded-control p-1.5 text-muted transition hover:bg-ink/[0.04] hover:text-ink"
                aria-label={copied ? 'Address copied' : 'Copy address'}
                title={copied ? 'Copied' : 'Copy address'}
              >
                {copied ? <Check className="h-4 w-4 text-mint" /> : <Copy className="h-4 w-4" />}
              </button>
              <a
                href={explorerAccountUrl(accountId, network)}
                target="_blank"
                rel="noreferrer"
                className="rounded-control p-1.5 text-muted transition hover:bg-ink/[0.04] hover:text-ink"
                aria-label="Open the account on NEARBlocks"
                title="Open in NEARBlocks"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}

        {step === 'balances' ? (
          <>
            {overview.loading && !overview.data ? (
              <div className="flex items-center gap-2 py-6 text-small text-muted">
                <Spinner /> Reading balances from NEAR
              </div>
            ) : overview.error ? (
              <Alert tone="danger" title="Could not load balances">
                {overview.error}
              </Alert>
            ) : overview.data && asset ? (
              <>
                {!overview.data.exists ? (
                  <Alert tone="warning" title="Account not initialized">
                    This implicit account has no on-chain state yet. Send NEAR to it before using
                    tokens.
                  </Alert>
                ) : null}

                <div className="rounded-card border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-meta font-medium text-muted">Available NEAR</p>
                      <p className="font-num mt-1 text-[26px] font-semibold tracking-tight">
                        {formatAssetAmount(overview.data.near.available, 24)}{' '}
                        <span className="text-ui font-normal text-muted">NEAR</span>
                      </p>
                    </div>
                    <Wallet className="h-5 w-5 text-brand" />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-meta">
                    <div>
                      <dt className="text-muted">Total</dt>
                      <dd className="font-num mt-0.5 font-medium">
                        {formatAssetAmount(overview.data.near.total, 24)} NEAR
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Staked</dt>
                      <dd className="font-num mt-0.5 font-medium">
                        {formatAssetAmount(overview.data.near.staked, 24)} NEAR
                      </dd>
                    </div>
                  </dl>
                </div>

                {network === 'mainnet' ? (
                  <div className="rounded-card border border-brand/20 bg-brand-soft p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-meta font-medium text-brand-deep">NEAR Intents</p>
                        <p className="font-num mt-1 text-[20px] font-semibold tracking-tight">
                          {overview.data.intents
                            ? formatAssetAmount(
                                overview.data.intents.balance,
                                overview.data.intents.decimals,
                              )
                            : '—'}{' '}
                          <span className="text-ui font-normal text-muted">USDC</span>
                        </p>
                        <p className="mt-0.5 text-meta text-muted">
                          Held in intents.near · withdrawable to a NEAR account
                        </p>
                      </div>
                      {overview.data.intents ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const selected = assets.find((item) => item.kind === 'intents');
                            if (selected) startSend(selected);
                          }}
                        >
                          Send
                        </Button>
                      ) : null}
                    </div>
                    {!overview.data.intents ? (
                      <p className="mt-2 text-meta text-muted">
                        Balance unavailable right now. Refresh to try again.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-meta font-medium text-muted">NEP-141 tokens</p>
                    <button
                      type="button"
                      onClick={refresh}
                      className="inline-flex items-center gap-1 text-meta text-muted transition hover:text-ink"
                    >
                      <RefreshCw className="h-3 w-3" /> Refresh
                    </button>
                  </div>
                  {overview.data.tokens.length === 0 ? (
                    <p className="rounded-control border border-dashed border-line px-3 py-4 text-small text-muted">
                      No NEP-141 tokens found for this account.
                    </p>
                  ) : (
                    <ul className="divide-y divide-line rounded-card border border-line">
                      {overview.data.tokens.map((token) => (
                        <li
                          key={token.contractId}
                          className="flex items-center justify-between gap-3 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-small font-medium">{token.symbol}</p>
                            <p className="truncate text-meta text-muted" title={token.contractId}>
                              {shortAddress(token.contractId, 10)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="font-num text-small">
                              {formatAssetAmount(token.balance, token.decimals)}
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                const selected = assets.find(
                                  (item) => item.key === token.contractId,
                                );
                                if (selected) startSend(selected);
                              }}
                            >
                              Send
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {overview.data.partial ? (
                    <p className="mt-2 text-meta text-muted">
                      Some tokens could not be discovered right now. Refresh to try again.
                    </p>
                  ) : null}
                </div>

                <Button className="w-full" onClick={() => startSend(asset)}>
                  <Send className="h-4 w-4" /> Send NEAR or a token
                </Button>
              </>
            ) : null}
          </>
        ) : null}

        {step === 'send' && asset ? (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep('balances');
                  setError(null);
                }}
                className="rounded-control p-1.5 text-muted transition hover:bg-ink/[0.04] hover:text-ink"
                aria-label="Back to balances"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <p className="text-small font-medium">Send</p>
            </div>

            <Field id="wallet-asset" label="Asset">
              <Select
                id="wallet-asset"
                value={asset.key}
                onChange={(event) => {
                  setAssetKey(event.target.value);
                  setError(null);
                }}
              >
                {assets.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.symbol}
                    {item.kind === 'intents' ? ' · NEAR Intents' : ''} ·{' '}
                    {formatAssetAmount(item.balance, item.decimals)} available
                  </option>
                ))}
              </Select>
            </Field>

            <Field id="wallet-recipient" label="Recipient">
              <Input
                id="wallet-recipient"
                value={recipient}
                onChange={(event) => {
                  setRecipient(event.target.value);
                  setError(null);
                }}
                placeholder="alice.near"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <Field
              id="wallet-amount"
              label="Amount"
              hint={
                asset.kind === 'near'
                  ? `Available ${formatAssetAmount(asset.balance, asset.decimals)} NEAR · keep 0.05 NEAR for fees`
                  : asset.kind === 'intents'
                    ? `Available ${formatAssetAmount(asset.balance, asset.decimals)} ${asset.symbol} in intents.near`
                    : `Available ${formatAssetAmount(asset.balance, asset.decimals)} ${asset.symbol}`
              }
            >
              <div className="flex gap-2">
                <Input
                  id="wallet-amount"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setError(null);
                  }}
                  placeholder="0.00"
                  inputMode="decimal"
                  autoComplete="off"
                />
                <Button type="button" variant="secondary" onClick={useMax}>
                  Max
                </Button>
              </div>
            </Field>

            <Button
              className="w-full"
              loading={busy}
              disabled={!recipient.trim() || !amount.trim()}
              onClick={() => void review()}
            >
              Review transfer
            </Button>
          </>
        ) : null}

        {step === 'review' && asset ? (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep('send');
                  setError(null);
                }}
                className="rounded-control p-1.5 text-muted transition hover:bg-ink/[0.04] hover:text-ink"
                aria-label="Back to edit"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <p className="text-small font-medium">Review transfer</p>
            </div>

            <dl className="divide-y divide-line rounded-card border border-line px-3">
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-small text-muted">Send</dt>
                <dd className="font-num text-small font-medium">
                  {amount.trim()} {asset.symbol}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-small text-muted">To</dt>
                <dd className="font-num min-w-0 truncate text-small font-medium">
                  {recipient.trim()}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-small text-muted">Network</dt>
                <dd className="text-small font-medium">NEAR {network}</dd>
              </div>
            </dl>

            {recipientInfo && !recipientInfo.exists ? (
              <Alert tone="warning" title="Implicit account not initialized">
                {asset.kind === 'near'
                  ? 'This account has no on-chain state yet. The transfer will create it if the amount covers the storage cost.'
                  : 'This account has no on-chain state yet. Token transfers need the account to exist first.'}
              </Alert>
            ) : null}

            {(asset.kind === 'token' || asset.kind === 'intents') &&
            recipientInfo?.registered === false ? (
              <div className="rounded-control border border-amber/25 bg-amber-soft px-3 py-2.5 text-small">
                <p>
                  The recipient is not registered for {asset.symbol}. A one-time storage deposit is
                  needed before the {asset.kind === 'intents' ? 'withdrawal' : 'token'} can arrive.
                  {asset.kind === 'intents'
                    ? ' This deposit is paid from your on-chain NEAR wallet.'
                    : ''}
                </p>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={registerStorage}
                    onChange={(event) => setRegisterStorage(event.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--color-brand)]"
                  />
                  Add storage deposit (
                  {formatAssetAmount(
                    recipientInfo.requiredStorageDeposit ?? '1250000000000000000000',
                    24,
                  )}{' '}
                  NEAR)
                </label>
              </div>
            ) : null}

            {asset.kind === 'intents' ? (
              <p className="rounded-control bg-surface-raised px-3 py-2 text-small text-muted">
                This withdraws USDC from intents.near to the recipient&apos;s NEAR wallet.
              </p>
            ) : null}

            <Button className="w-full" loading={busy} onClick={() => void confirm()}>
              Confirm and sign
            </Button>
            <p className="text-center text-meta text-muted">
              Your wallet will ask you to approve this transaction.
            </p>
          </>
        ) : null}

        {step === 'sent' ? (
          <div className="space-y-4 py-2 text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-soft text-mint">
              <Check className="h-5 w-5" />
            </div>
            <div>
              <p className="text-small font-medium">Transfer submitted</p>
              <p className="mt-1 text-meta text-muted">
                Balances refresh automatically once the transaction lands.
              </p>
            </div>
            {explorerTxUrl(txHash, network) ? (
              <a
                href={explorerTxUrl(txHash, network) ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-small font-medium text-brand-deep hover:underline"
              >
                View transaction <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <p className="font-num break-all text-meta text-muted">{txHash}</p>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setStep('balances');
                setTxHash('');
                refresh();
              }}
            >
              Back to wallet
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function friendlyTransferError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/reject|cancel|denied|closed|dismiss|abort/i.test(message)) {
    return 'The transfer was cancelled.';
  }
  if (/not registered|storage/i.test(message)) {
    return 'The recipient is not registered for this token. Add the storage deposit and try again.';
  }
  if (/insufficient|not enough|balance/i.test(message)) {
    return 'Insufficient balance for this transfer.';
  }
  return message || 'Could not send the transfer.';
}
