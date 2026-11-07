'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Fingerprint, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Logo } from '@/components/logo';
import { NearProtocolIcon } from '@/components/landing/logos';

export default function LoginPage() {
  const {
    session,
    loading,
    passkeyBusy,
    passkeyEnabled,
    walletLoginEnabled,
    signIn,
    signInWithPasskey,
    busy,
    error,
    clearError,
  } = useAuth();
  const router = useRouter();
  const [whyOpen, setWhyOpen] = useState(false);

  useEffect(() => {
    if (!loading && session?.user) router.replace('/dashboard');
  }, [loading, session, router]);

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
          Use a passkey for the easiest experience
          {walletLoginEnabled ? ', or connect a wallet' : ''}.
        </p>
        <button
          type="button"
          onClick={() => setWhyOpen((value) => !value)}
          className="mt-1.5 inline-flex items-center gap-1 text-[13px] text-muted underline decoration-line-strong underline-offset-4 transition hover:text-ink"
        >
          Why a passkey?
          <ChevronDown className={`h-3.5 w-3.5 transition ${whyOpen ? 'rotate-180' : ''}`} />
        </button>

        {whyOpen ? (
          <div className="mt-3 rounded-xl bg-paper px-4 py-3 text-[12px] leading-relaxed text-muted">
            A passkey uses your device biometrics or screen lock. There is no seed phrase and no
            browser extension. Your NEAR key is derived by an MPC network and signs a one-time
            message for this site.
          </div>
        ) : null}

        <div className="mt-7">
          {passkeyEnabled ? (
            <button
              type="button"
              onClick={() => void signInWithPasskey()}
              disabled={passkeyBusy}
              className="group w-full rounded-2xl border border-line bg-white p-5 text-left transition hover:border-line-strong hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] disabled:cursor-wait disabled:opacity-70"
            >
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
              <p className="mt-5 text-[15px] font-semibold">
                {passkeyBusy ? 'Waiting for passkey…' : 'Sign in with passkey'}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                Use your device biometrics or passcode to sign in.
              </p>
            </button>
          ) : (
            <div className="rounded-2xl border border-amber/20 bg-amber-soft p-5 text-[13px] leading-relaxed text-amber">
              Passkey login is not configured. Set{' '}
              <span className="font-num">NEXT_PUBLIC_PASSKEY_ENABLED</span> and{' '}
              <span className="font-num">NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID</span>.
            </div>
          )}
        </div>

        {walletLoginEnabled ? (
          <>
            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
                NEAR wallets
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={busy}
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
          </>
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
            <NearProtocolIcon className="h-3.5 w-3.5" /> Secured by NEAR Auth · MPC signing
          </p>
        </div>
      </div>
    </div>
  );
}
