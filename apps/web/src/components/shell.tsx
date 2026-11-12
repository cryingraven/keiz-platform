'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  Contact,
  FileText,
  HandCoins,
  LayoutDashboard,
  Menu,
  Receipt,
  ScrollText,
  Settings,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { networkLabel } from '@/lib/network';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { NearCredit } from './landing/logos';
import { ConnectButton } from './connect-button';
import { Spinner } from './ui';
import { AssistantProvider, useAssistant } from './assistant';
import { FeedbackProvider } from './feedback';

const NAV_GROUPS = [
  {
    label: 'Work',
    items: [
      { href: '/dashboard', label: 'Today', icon: LayoutDashboard },
      { href: '/dashboard/invoices', label: 'Bills', icon: FileText },
      { href: '/dashboard/receivables', label: 'Invoices', icon: HandCoins },
      { href: '/dashboard/payments', label: 'Payments', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Books',
    items: [
      { href: '/dashboard/accounting', label: 'Accounting', icon: BookOpen },
      { href: '/dashboard/expenses', label: 'Expenses', icon: Receipt },
      { href: '/dashboard/revenue', label: 'Revenue', icon: TrendingUp },
      { href: '/dashboard/reporting', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    label: 'Contacts',
    items: [
      { href: '/dashboard/vendors', label: 'Vendors', icon: Building2 },
      { href: '/dashboard/customers', label: 'Customers', icon: Contact },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard/agent', label: 'Agent wallet', icon: Wallet },
      { href: '/dashboard/team', label: 'Team', icon: Users },
      { href: '/dashboard/audit', label: 'Audit log', icon: ScrollText },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function currentLabel(pathname: string): string {
  if (pathname.startsWith('/dashboard/chat')) return 'Chat';
  const match = NAV.filter((item) => item.href !== '/dashboard').find((item) =>
    isActive(pathname, item.href),
  );
  return match?.label ?? 'Today';
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <FeedbackProvider>
      <AssistantProvider>
        <ShellFrame>{children}</ShellFrame>
      </AssistantProvider>
    </FeedbackProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const { openAssistant } = useAssistant();
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

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (loading || !session?.user) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas">
        <div className="flex items-center gap-3 text-ui text-muted">
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
    <div className="px-1">
      <p className="text-meta text-muted">Workspace</p>
      {(orgs.data?.length ?? 0) > 1 ? (
        <select
          value={session.org?.id ?? ''}
          disabled={switching}
          onChange={(event) => void switchOrg(event.target.value)}
          className="mt-1 w-full rounded-control border border-line bg-surface px-2 py-1.5 text-small font-medium text-ink outline-none focus:border-brand/60"
          aria-label="Switch workspace"
        >
          {(orgs.data ?? []).map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="mt-1 truncate text-ui font-medium text-ink">{session.org?.name}</p>
      )}
      <p className="mt-0.5 truncate font-num text-meta text-muted">{session.user.accountId}</p>
    </div>
  );

  const nav = (
    <nav className="flex flex-col gap-6" aria-label="Workspace">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-2 text-meta font-medium text-muted">{group.label}</p>
          <div className="mt-1 flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-control px-2 py-2 text-ui transition-colors',
                    active
                      ? 'bg-surface font-medium text-ink shadow-panel ring-1 ring-line'
                      : 'text-muted hover:bg-ink/[0.04] hover:text-ink',
                  )}
                >
                  {active ? (
                    <span
                      className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand"
                      aria-hidden
                    />
                  ) : null}
                  <item.icon className={cn('h-4 w-4', active ? 'text-brand' : 'text-muted')} />
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
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-small focus:text-white"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-screen flex-col justify-between border-r border-line bg-canvas px-3 py-4 lg:flex">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-2">
            <Logo />
          </div>
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto pb-4 scroll-thin">{nav}</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-3">
          {workspace}
          <div className="mt-3 border-t border-line pt-2">
            <NearCredit />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="rounded-control p-2 text-muted hover:bg-ink/[0.04] hover:text-ink lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="mobile-navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="truncate text-ui font-medium text-ink lg:hidden">{currentLabel(pathname)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => openAssistant()}
              aria-label="Open AI assistant"
              className="hidden h-8 items-center gap-1.5 rounded-control px-2.5 text-small font-medium text-muted transition hover:bg-ink/[0.04] hover:text-ink sm:inline-flex"
            >
              <Bot className="h-3.5 w-3.5" /> Ask
            </button>
            <span
              className="hidden text-meta font-medium text-muted sm:inline"
              title={`NEAR ${networkLabel}`}
            >
              NEAR {networkLabel}
            </span>
            <ConnectButton compact />
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <div
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
            className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-line bg-canvas px-3 py-4"
          >
            <div className="flex items-center justify-between px-2">
              <Logo />
              <button
                onClick={() => setOpen(false)}
                className="rounded-control p-1.5 text-muted hover:bg-ink/[0.04] hover:text-ink"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-6 min-h-0 flex-1 overflow-y-auto pb-4 scroll-thin">{nav}</div>
            <div className="mt-auto border-t border-line px-1 pt-4">
              {workspace}
              <div className="mt-3 px-1">
                <NearCredit />
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
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-2">{breadcrumb}</div> : null}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em]">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-ui leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
