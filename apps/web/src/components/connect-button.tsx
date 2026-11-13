'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, LogOut, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { shortAddress } from '@/lib/format';
import { WalletPanel } from './wallet-panel';

export function ConnectButton({ compact = false }: { compact?: boolean }) {
  const { session, loading, signOut } = useAuth();
  const [walletOpen, setWalletOpen] = useState(false);
  const size = compact ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm';

  if (loading) {
    return (
      <span
        className={`inline-flex items-center gap-2 rounded-full border border-line bg-surface text-muted ${size}`}
      >
        <span className="h-3.5 w-3.5 animate-pulse rounded-full bg-line-strong" />
        Checking session
      </span>
    );
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setWalletOpen(true)}
          className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium transition hover:border-line-strong hover:bg-surface-raised sm:flex"
          aria-haspopup="dialog"
          aria-expanded={walletOpen}
          aria-label={`Open wallet for ${session.user.accountId}`}
          title="Balances and transfers"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-mint" />
          <span className="font-num">{shortAddress(session.user.accountId, 6)}</span>
          <ChevronDown className="h-3 w-3 text-muted" />
        </button>
        <button
          type="button"
          onClick={() => setWalletOpen(true)}
          className="rounded-full border border-line bg-surface p-2 text-muted transition hover:border-line-strong hover:text-ink sm:hidden"
          aria-haspopup="dialog"
          aria-expanded={walletOpen}
          aria-label="Open wallet"
        >
          <Wallet className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-full p-2 text-muted transition hover:bg-ink/5 hover:text-ink"
          aria-label="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
        <WalletPanel open={walletOpen} onClose={() => setWalletOpen(false)} />
      </div>
    );
  }

  return (
    <Link
      href="/login"
      className={`inline-flex items-center justify-center rounded-full bg-ink font-medium text-white transition hover:bg-ink-soft ${size}`}
    >
      Sign in
    </Link>
  );
}
