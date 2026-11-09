'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Fingerprint, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { chainNetwork } from '@/lib/network';
import { preloadNearAuth } from '@/lib/near-auth';
import { Logo } from '@/components/logo';
import { NearProtocolIcon } from '@/components/landing/logos';

export default function LoginPage() {
  const {
    session,
    loading,
    nearAuthBusy,
    nearAuthEnabled,
    signIn,
    signInWithNearAuth,
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
  const [whyOpen, setWhyOpen] = useState(false);

  useEffect(() => {
    if (!loading && session?.user) router.replace('/dashboard');
  }, [loading, session, router]);

  useEffect(() => {
    // Warm both clients while the user is still on /login. This keeps the
    // wallet selector and Auth0 popup inside the original click gesture.
    void preloadWallets();
    void preloadNearAuth().catch(() => {
      // NEAR Auth setup errors are surfaced when the user actually clicks.
    });
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
          {nearAuthEnabled
            ? 'Use NEAR Auth for the easiest experience, or connect a NEAR wallet.'
            : 'Connect a NEAR wallet to sign a one-time message.'}
        </p>
        {networkMismatch ? (
          <div className="mt-3 rounded-xl border border-amber/20 bg-amber-soft px-4 py-3 text-[12px] leading-relaxed text-amber">
            This page is configured for NEAR {chainNetwork}, but the API is on{' '}
            {health.data?.network}. Wallet and NEAR Auth sign-in will be rejected until the
            deployment networks are aligned.
          </div>
        ) : null}

        {nearAuthEnabled ? (
          <>
            <div className="mt-7">
              <button
                type="button"
                onClick={() => void signInWithNearAuth()}
                disabled={nearAuthBusy || busy}
                className="group w-full rounded-2xl border border-line bg-white p-5 text-left transition hover:border-line-strong hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] disabled:cursor-wait disabled:opacity-70"
              >
                <div className="flex items-start justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-ink text-white">
                    {nearAuthBusy ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Fingerprint className="h-5 w-5" />
                    )}
                  </span>
                  <span className="rounded-full bg-mint-soft px-2.5 py-1 text-[11px] font-medium text-mint">
                    Recommended
                  </span>
                </div>
                <p className="mt-5 text-[15px] font-semibold">
                  {nearAuthBusy ? 'Waiting for NEAR Auth…' : 'Continue with NEAR Auth'}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Use a passkey, Google, Apple or email. No seed phrase, no extension.
                </p>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setWhyOpen((value) => !value)}
              className="mt-2 inline-flex items-center gap-1 text-[13px] text-muted underline decoration-line-strong underline-offset-4 transition hover:text-ink"
            >
              Why NEAR Auth?
              <ChevronDown className={`h-3.5 w-3.5 transition ${whyOpen ? 'rotate-180' : ''}`} />
            </button>

            {whyOpen ? (
              <div className="mt-3 rounded-xl bg-paper px-4 py-3 text-[12px] leading-relaxed text-muted">
                NEAR Auth signs you in through Auth0, then an MPC network produces a NEP-413
                signature for your account. The key is never held by one party, and KEIZ never
                receives a private key.
              </div>
            ) : null}
          </>
        ) : null}

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
          <button
            type="button"
            onClick={() => void signIn()}
            disabled={busy || nearAuthBusy}
            className="group flex w-full items-center gap-4 rounded-2xl border border-line bg-white p-5 text-left transition hover:border-line-strong hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] disabled:cursor-wait disabled:opacity-70"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-white">
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <NearProtocolIcon className="h-5 w-5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">NEAR Wallets</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                {busy
                  ? 'Opening wallet selector…'
                  : 'HOT, Meteor, Nightly, MyNearWallet and more.'}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted transition group-hover:text-ink" />
          </button>
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
            <NearProtocolIcon className="h-3.5 w-3.5" /> NEP-413 message signature · verified by KEIZ
          </p>
        </div>
      </div>
    </div>
  );
}
