'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ChevronRight, Fingerprint, Loader2, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { chainNetwork } from '@/lib/network';
import { Logo } from '@/components/logo';

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
    busy,
    error,
    clearError,
    preloadWallets,
    accounts,
    chooseAccount,
    cancelAccountSelection,
  } = useAuth();
  const router = useRouter();
  const health = useApi<{ network?: string }>('/health');

  useEffect(() => {
    if (!loading && session?.user) router.replace('/dashboard');
  }, [loading, session, router]);

  useEffect(() => {
    // Warm the wallet connector while the user is still on /login, so the
    // selector opens inside the original click gesture.
    void preloadWallets();
  }, [preloadWallets]);

  const networkMismatch =
    Boolean(health.data?.network) && health.data?.network !== chainNetwork;

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col justify-center px-5 py-10 sm:py-16">
        <Logo large />

        <h1 className="mt-8 text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[30px]">
          Sign in
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Use a passkey or a NEAR wallet.
        </p>
        {networkMismatch ? (
          <div className="mt-3 rounded-xl border border-amber/20 bg-amber-soft px-4 py-3 text-[13px] leading-relaxed text-amber">
            This page is on NEAR {chainNetwork}, but the API is on {health.data?.network}.
            Sign-in is blocked until they match.
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
                <span className="rounded-full bg-mint-soft px-2.5 py-1 text-[12px] font-medium text-mint">
                  Recommended
                </span>
              </div>
              <p className="mt-5 text-[15px] font-semibold">Continue with a passkey</p>
              <p className="mt-1 text-[14px] leading-relaxed text-muted">
                Face ID, Touch ID or Windows Hello. Your key stays on this device.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void createPasskeyAccount()}
                  disabled={passkeyBusy || busy}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-ink-soft disabled:cursor-wait disabled:opacity-60"
                >
                  Create account
                </button>
                <button
                  type="button"
                  onClick={() => void signInWithPasskey()}
                  disabled={passkeyBusy || busy}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-[14px] font-medium text-ink transition hover:border-ink/30 disabled:cursor-wait disabled:opacity-60"
                >
                  Sign in
                </button>
              </div>
              {!passkeyReady ? (
                <p className="mt-3 text-[12px] leading-relaxed text-amber">
                  Passkey support is unconfirmed here. Use a wallet below if this fails.
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="mt-7 rounded-2xl border border-line bg-white p-5">
            <p className="text-[14px] font-semibold">Passkeys are not available here</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Connect a NEAR wallet below.
            </p>
          </div>
        )}

        <div className="mt-6 border-t border-line pt-6">
          {accounts.length > 1 ? (
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-[14px] font-semibold">Choose an account</p>
              <p className="mt-0.5 text-[12px] text-muted">
                This wallet has more than one NEAR account.
              </p>
              <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
                {accounts.map((account) => (
                  <button
                    key={account.accountId}
                    type="button"
                    disabled={busy}
                    onClick={() => void chooseAccount(account.accountId)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 text-left transition hover:border-line-strong disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="font-num truncate text-[13px]">{account.accountId}</span>
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
                className="mt-2 inline-flex min-h-11 items-center text-[12px] text-muted underline decoration-line-strong underline-offset-2 hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={busy || passkeyBusy}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-3 text-left text-[14px] font-medium text-ink transition hover:border-ink/30 disabled:cursor-wait disabled:opacity-60"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paper text-ink">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
              </span>
              <span className="flex-1">
                {busy ? 'Opening wallet…' : 'Continue with a NEAR wallet'}
              </span>
              {busy ? null : <ChevronRight className="h-4 w-4 shrink-0 text-muted" />}
            </button>
          )}
        </div>

        {chainNetwork === 'testnet' ? (
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Note: Some wallets are mainnet-only.
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            aria-live="polite"
            className="mt-4 rounded-xl border border-rose/20 bg-rose-soft px-4 py-3 text-[13px] leading-relaxed text-rose"
          >
            {error}
            <button className="ml-2 underline" onClick={clearError}>
              dismiss
            </button>
          </div>
        ) : null}

        <div className="mt-8 border-t border-line pt-5">
          <p className="text-[12px] leading-relaxed text-muted">
            By continuing you agree to the{' '}
            <Link href="/terms" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
