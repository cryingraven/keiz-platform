'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Fingerprint, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { chainNetwork } from '@/lib/network';
import { Logo } from '@/components/logo';
import { NearProtocolIcon } from '@/components/landing/logos';

export default function LoginPage() {
  const {
    session,
    loading,
    passkeyBusy,
    passkeySupported,
    passkeyReady,
    signIn,
    signInWithPasskey,
    createPasskeyAccount,
    signInWithRecoveryKey,
    busy,
    error,
    clearError,
    preloadWallets,
    wallets,
    walletsLoading,
    activeWalletId,
    signInWithWallet,
    accounts,
    chooseAccount,
    cancelAccountSelection,
  } = useAuth();
  const router = useRouter();
  const health = useApi<{ network?: string }>('/health');
  const [whyOpen, setWhyOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryAccount, setRecoveryAccount] = useState('');

  useEffect(() => {
    if (!loading && session?.user) router.replace('/dashboard');
  }, [loading, session, router]);

  useEffect(() => {
    // Warm the wallet connector while the user is still on /login, so a row
    // click can connect inside the original click gesture.
    void preloadWallets();
  }, [preloadWallets]);

  const networkMismatch =
    Boolean(health.data?.network) && health.data?.network !== chainNetwork;

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-ink">
      <div className="mx-auto w-full max-w-[460px] px-5 pb-16 pt-12 sm:pt-20">
        <Logo large />

        <h1 className="mt-10 text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[30px]">
          Sign in or create your workspace
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Create a self-custodial passkey account, or connect a NEAR wallet.
        </p>
        {networkMismatch ? (
          <div className="mt-3 rounded-xl border border-amber/20 bg-amber-soft px-4 py-3 text-[12px] leading-relaxed text-amber">
            This page is configured for NEAR {chainNetwork}, but the API is on{' '}
            {health.data?.network}. Sign-in will be rejected until the deployment networks are
            aligned.
          </div>
        ) : null}

        {passkeySupported ? (
          <>
            <div className="mt-7 rounded-2xl border border-line bg-white p-5">
              <div className="flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-ink text-white">
                  {passkeyBusy ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Fingerprint className="h-5 w-5" />
                  )}
                </span>
                <span className="rounded-full bg-mint-soft px-2.5 py-1 text-[11px] font-medium text-mint">
                  Recommended
                </span>
              </div>
              <p className="mt-5 text-[15px] font-semibold">Continue with a passkey</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                Face ID, Touch ID or Windows Hello. Your NEAR key is derived on this device and is
                never sent to KEIZ.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void createPasskeyAccount()}
                  disabled={passkeyBusy || busy}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-ink-soft disabled:cursor-wait disabled:opacity-60"
                >
                  Create a passkey account
                </button>
                <button
                  type="button"
                  onClick={() => void signInWithPasskey()}
                  disabled={passkeyBusy || busy}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-[13px] font-medium text-ink transition hover:border-ink/30 disabled:cursor-wait disabled:opacity-60"
                >
                  I already have one
                </button>
              </div>
              {!passkeyReady ? (
                <p className="mt-3 text-[11px] leading-relaxed text-amber">
                  This browser could not confirm PRF passkey support. If creating an account fails,
                  use a NEAR wallet below.
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setRecoveryOpen((value) => !value)}
              className="mt-2 inline-flex items-center gap-1 text-[13px] text-muted underline decoration-line-strong underline-offset-4 transition hover:text-ink"
            >
              Use a recovery key
              <ChevronDown
                className={`h-3.5 w-3.5 transition ${recoveryOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {recoveryOpen ? (
              <div className="mt-3 rounded-xl border border-line bg-white p-4">
                <p className="text-[12px] leading-relaxed text-muted">
                  Paste the NEAR recovery key you exported when you created the passkey account.
                  It is used locally to sign the NEP-413 challenge; it is never sent to the API.
                </p>
                <textarea
                  value={recoveryKey}
                  onChange={(event) => setRecoveryKey(event.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder="ed25519:..."
                  className="mt-3 w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[11px] text-ink outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/10"
                />
                <input
                  value={recoveryAccount}
                  onChange={(event) => setRecoveryAccount(event.target.value)}
                  spellCheck={false}
                  placeholder="NEAR account (only for a wallet account)"
                  className="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[11px] text-ink outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/10"
                />
                <button
                  type="button"
                  onClick={() => void signInWithRecoveryKey(recoveryKey, recoveryAccount)}
                  disabled={passkeyBusy || busy || recoveryKey.trim().length === 0}
                  className="mt-3 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {passkeyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Sign in with recovery key
                </button>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setWhyOpen((value) => !value)}
              className="mt-2 inline-flex items-center gap-1 text-[13px] text-muted underline decoration-line-strong underline-offset-4 transition hover:text-ink"
            >
              How does a passkey account work?
              <ChevronDown className={`h-3.5 w-3.5 transition ${whyOpen ? 'rotate-180' : ''}`} />
            </button>

            {whyOpen ? (
              <div className="mt-3 rounded-xl bg-paper px-4 py-3 text-[12px] leading-relaxed text-muted">
                The passkey unlocks a random ed25519 seed in your browser using the WebAuthn PRF
                extension. The seed is the NEAR account key; KEIZ only stores an encrypted copy that
                it cannot decrypt. Your passkey never leaves your device.
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-7 rounded-2xl border border-line bg-white p-5">
            <p className="text-[13px] font-semibold">Passkeys are not available here</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              This browser does not expose WebAuthn. Connect a NEAR wallet below.
            </p>
          </div>
        )}

        <div className="my-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
            NEAR wallets
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>

        {accounts.length > 1 ? (
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="text-[13px] font-semibold">Choose an account</p>
            <p className="mt-0.5 text-[11px] text-muted">
              This wallet has more than one NEAR account. Pick the one to use for KEIZ.
            </p>
            <div className="mt-3 space-y-1.5">
              {accounts.map((account) => (
                <button
                  key={account.accountId}
                  type="button"
                  disabled={busy}
                  onClick={() => void chooseAccount(account.accountId)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 text-left transition hover:border-line-strong disabled:cursor-wait disabled:opacity-60"
                >
                  <span className="font-num truncate text-[12px]">{account.accountId}</span>
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted" />
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={cancelAccountSelection}
              disabled={busy}
              className="mt-3 text-[11px] text-muted underline decoration-line-strong underline-offset-2 hover:text-ink disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
                NEAR wallets
              </p>
              {wallets.length > 0 ? (
                <span className="font-num text-[10px] text-muted">{wallets.length}</span>
              ) : null}
            </div>

            {walletsLoading ? (
              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-center gap-3 px-4 py-3">
                    <span className="h-9 w-9 animate-pulse rounded-lg bg-paper" />
                    <span className="flex-1 space-y-1.5">
                      <span className="block h-3 w-28 animate-pulse rounded bg-paper" />
                      <span className="block h-2.5 w-40 animate-pulse rounded bg-paper" />
                    </span>
                  </div>
                ))}
              </div>
            ) : wallets.length === 0 ? (
              <div className="rounded-2xl border border-line bg-white p-5">
                <p className="text-[13px] font-semibold">No compatible wallet found</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  No installed or web wallet supports NEP-413 message signing on this
                  network. Open the wallet selector or install a NEAR wallet.
                </p>
                <button
                  type="button"
                  onClick={() => void signIn()}
                  disabled={busy || passkeyBusy}
                  className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-brand hover:underline disabled:opacity-60"
                >
                  Open wallet selector
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
                {wallets.map((wallet) => {
                  const connecting = busy && activeWalletId === wallet.id;
                  return (
                    <button
                      key={wallet.id}
                      type="button"
                      onClick={() => void signInWithWallet(wallet.id)}
                      disabled={busy || passkeyBusy}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-paper disabled:cursor-wait disabled:opacity-60"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={wallet.icon}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-9 w-9 shrink-0 rounded-lg bg-paper object-contain"
                        onError={(event) => {
                          event.currentTarget.style.visibility = 'hidden';
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold">
                            {wallet.name}
                          </span>
                          <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted">
                            {wallet.type === 'injected' ? 'Extension' : 'Web'}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {connecting ? 'Connecting…' : wallet.description}
                        </span>
                      </span>
                      {connecting ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted transition group-hover:text-ink" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {wallets.length > 0 ? (
              <button
                type="button"
                onClick={() => void signIn()}
                disabled={busy || passkeyBusy}
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted underline decoration-line-strong underline-offset-2 transition hover:text-ink disabled:opacity-60"
              >
                More wallets / open selector
                <ChevronRight className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        )}

        {chainNetwork === 'testnet' ? (
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Some NEAR wallets are mainnet-only and will not appear in the testnet selector.
          </p>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-rose/20 bg-rose-soft px-4 py-3 text-[12px] leading-relaxed text-rose">
            {error}
            <button className="ml-2 underline" onClick={clearError}>
              dismiss
            </button>
          </div>
        ) : null}

        <div className="mt-10 border-t border-line pt-5">
          <p className="text-[11px] leading-relaxed text-muted">
            By signing in or creating an account, you agree to the{' '}
            <Link href="/terms" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
              Terms of Service
            </Link>{' '}
            and acknowledge the{' '}
            <Link href="/privacy" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
              Privacy Policy
            </Link>
            .
          </p>
          <p className="mt-4 flex items-center gap-1.5 text-[10px] text-muted">
            <NearProtocolIcon className="h-3.5 w-3.5" /> Passkey · self-custodial NEAR key
          </p>
        </div>
      </div>
    </div>
  );
}
