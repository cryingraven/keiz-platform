'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Building2,
  Contact,
  FileText,
  HandCoins,
  LayoutDashboard,
  Menu,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { isMainnet, networkLabel } from '@/lib/network';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { NearCredit } from './landing/logos';
import { ConnectButton } from './connect-button';
import { Spinner } from './ui';
import { AssistantProvider } from './assistant';
import { FeedbackProvider } from './feedback';

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    label: 'Money',
    items: [
      { href: '/dashboard/invoices', label: 'Bills (AP)', icon: FileText },
      { href: '/dashboard/receivables', label: 'Receivables (AR)', icon: HandCoins },
      { href: '/dashboard/payments', label: 'Payments', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Books',
    items: [
      { href: '/dashboard/accounting', label: 'Accounting', icon: BookOpen },
      { href: '/dashboard/reporting', label: 'Reporting', icon: BarChart3 },
    ],
  },
  {
    label: 'Directory',
    items: [
      { href: '/dashboard/customers', label: 'Customers', icon: Contact },
      { href: '/dashboard/vendors', label: 'Vendors', icon: Building2 },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard/team', label: 'Team', icon: Users },
      { href: '/dashboard/agent', label: 'Agent wallet', icon: Wallet },
      { href: '/dashboard/audit', label: 'Audit log', icon: ScrollText },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);

export function Shell({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const orgs = useApi<Array<{ id: string; name: string; slug: string; role: string }>>(
    session?.user ? '/auth/orgs' : null,
  );
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!loading && !session?.user) router.replace('/login');
  }, [loading, session, router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (loading || !session?.user) {
    return (
      <div className="grid min-h-screen place-items-center bg-white">
        <div className="flex items-center gap-3 text-sm text-muted">
          <Spinner /> Redirecting to sign in
        </div>
      </div>
    );
  }

  async function switchOrg(orgId: string) {
    if (!orgId || orgId === session?.org?.id) return;
    setSwitching(true);
    try {
      await api('/auth/switch-org', {
        method: 'POST',
        body: JSON.stringify({ orgId }),
      });
      window.location.reload();
    } finally {
      setSwitching(false);
    }
  }

  const workspace = (
    <>
      <div className="flex items-center gap-2 text-[12px] text-white/50">
        <Sparkles className="h-3.5 w-3.5" />
        Workspace
      </div>
      {(orgs.data?.length ?? 0) > 1 ? (
        <select
          value={session.org?.id ?? ''}
          disabled={switching}
          onChange={(event) => void switchOrg(event.target.value)}
          className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1.5 text-[13px] font-medium text-white outline-none"
          aria-label="Switch workspace"
        >
          {(orgs.data ?? []).map((org) => (
            <option key={org.id} value={org.id} className="text-ink">
              {org.id === session.org?.id ? session.org?.name ?? org.name : org.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="mt-1 truncate text-[14px] font-medium text-white">{session.org?.name}</p>
      )}
      <p className="mt-0.5 truncate font-num text-[12px] text-white/40">
        {session.user.accountId}
      </p>
    </>
  );
  const nav = (
    <nav className="flex flex-col gap-5" aria-label="Workspace">
      {NAV_GROUPS.map((group, groupIndex) => (
        <div key={group.label}>
          <p
            className={cn(
              'px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35',
              groupIndex === 0 && 'sr-only',
            )}
          >
            {group.label}
          </p>
          <div className={cn('flex flex-col gap-0.5', groupIndex > 0 && 'mt-1.5')}>
            {group.items.map((item) => {
              const active =
                item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group flex items-center gap-2.5 rounded-control px-3 py-2 text-[14px] font-medium transition',
                    active
                      ? 'bg-white/10 text-white'
                      : 'text-white/60 hover:bg-white/5 hover:text-white',
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col justify-between bg-ink px-4 py-5 lg:flex">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-2">
            <Logo light />
          </div>
          <div className="mt-8 min-h-0 flex-1 overflow-y-auto pb-4 scroll-thin">{nav}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          {workspace}
          <div className="mt-3 border-t border-white/10 pt-2">
            <NearCredit dark />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-paper/85 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-1.5 text-muted hover:bg-ink/5 lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="mobile-navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-[14px] font-medium text-muted">
              {NAV.find((item) =>
                item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href),
              )?.label ?? 'Workspace'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em]',
                isMainnet ? 'bg-mint-soft text-mint' : 'bg-amber-soft text-amber',
              )}
              title={`NEAR ${networkLabel}`}
            >
              {networkLabel}
            </span>
            <ConnectButton compact />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <FeedbackProvider>
            <AssistantProvider>{children}</AssistantProvider>
          </FeedbackProvider>
        </main>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
            className="absolute left-0 top-0 flex h-full w-72 flex-col bg-ink px-4 py-5"
          >
            <div className="flex items-center justify-between px-2">
              <Logo light />
              <button onClick={() => setOpen(false)} className="p-1.5 text-white/60">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-8 min-h-0 flex-1 overflow-y-auto pb-4 scroll-thin">{nav}</div>
            <div className="mt-auto border-t border-white/10 px-2 pt-4">
              {workspace}
              <div className="mt-3">
                <NearCredit dark />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
