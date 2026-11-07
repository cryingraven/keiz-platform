'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CircleDollarSign,
  Clock,
  FileText,
  Plus,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { formatDate, formatDollars, formatMoney, humanize, timeLeft } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, EmptyState, ErrorState, SectionTitle, Spinner, StatusPill } from '@/components/ui';

interface Invoice {
  _id: string;
  number: string;
  status: string;
  total: string;
  decimals: number;
  currency: string;
  dueDate: string;
}
interface Payment {
  _id: string;
  status: string;
  amountOutFormatted?: string;
  deadline?: string;
}
interface AgentStats {
  spentTodayUsd: string;
  pendingApprovals: number;
  accountId: string | null;
  active: boolean;
}
interface Vendor {
  _id: string;
  name: string;
}
interface Books {
  currency: string;
  decimals: number;
  cash: string;
  receivable: string;
  payable: string;
  revenue: string;
  expenses: string;
  netIncome: string;
}

const OPEN_STATUSES = ['SUBMITTED', 'APPROVED', 'PAYMENT_PENDING'];

export default function OverviewPage() {
  const invoices = useApi<Invoice[]>('/invoices');
  const payments = useApi<Payment[]>('/payments', { pollMs: 5000 });
  const vendors = useApi<Vendor[]>('/vendors');
  const agent = useApi<AgentStats>('/agent/stats');
  const books = useApi<Books>('/accounting/summary?currency=USD');
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const rows = invoices.data ?? [];
    // Totals are only meaningful per currency. The overview is USD-denominated;
    // mixing EUR/SGD/IDR into a dollar figure is misleading.
    const usd = rows.filter((row) => row.currency === 'USD');
    const open = usd.filter((row) => OPEN_STATUSES.includes(row.status));
    const outstanding = open.reduce(
      (sum, row) => sum + Number(row.total) / 10 ** row.decimals,
      0,
    );
    const paid = usd
      .filter((row) => row.status === 'PAID')
      .reduce((sum, row) => sum + Number(row.total) / 10 ** row.decimals, 0);
    const awaiting = rows.filter((row) => row.status === 'SUBMITTED').length;
    const inFlight = (payments.data ?? []).filter((payment) =>
      ['AWAITING_DEPOSIT', 'PROCESSING'].includes(payment.status),
    );
    return { outstanding, paid, awaiting, inFlight };
  }, [invoices.data, payments.data]);

  const demoEmpty = !invoices.loading && !invoices.error && (invoices.data?.length ?? 0) === 0;

  async function seed() {
    setSeeding(true);
    setSeedError(null);
    try {
      await api('/demo/seed', { method: 'POST' });
      await Promise.all([
        invoices.reload(),
        vendors.reload(),
        payments.reload(),
        agent.reload(),
        books.reload(),
      ]);
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Could not seed demo data');
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Cash out the door, approvals waiting, and agent activity."
        actions={
          <>
            {demoEmpty ? (
              <Button variant="secondary" size="md" loading={seeding} onClick={() => void seed()}>
                <Sparkles className="h-3.5 w-3.5" /> Load demo data
              </Button>
            ) : null}
            <Link href="/dashboard/invoices">
              <Button size="md">
                <Plus className="h-3.5 w-3.5" /> New bill
              </Button>
            </Link>
          </>
        }
      />

      {seedError ? (
        <p className="mb-4 rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
          {seedError}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Outstanding"
          value={formatDollars(stats.outstanding)}
          meta={`USD · ${stats.awaiting} awaiting approval`}
          icon={<CircleDollarSign className="h-4 w-4" />}
        />
        <Stat
          label="Paid to date"
          value={formatDollars(stats.paid)}
          meta={`USD · ${invoices.data?.filter((row) => row.status === 'PAID' && row.currency === 'USD').length ?? 0} settled bills`}
          icon={<FileText className="h-4 w-4" />}
        />
        <Stat
          label="In flight"
          value={String(stats.inFlight.length)}
          meta={
            stats.inFlight[0]?.deadline
              ? `next deadline ${timeLeft(stats.inFlight[0].deadline)}`
              : 'no open quotes'
          }
          icon={<Clock className="h-4 w-4" />}
        />
        <Stat
          label="Agent spend today"
          value={formatDollars(agent.data?.spentTodayUsd ?? '0')}
          meta={
            agent.data?.pendingApprovals
              ? `${agent.data.pendingApprovals} proposal(s) waiting`
              : 'within policy'
          }
          icon={<Wallet className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 flex items-end justify-between">
        <SectionTitle
          title="Books"
          hint="Cash, receivables and payables from the double-entry ledger"
        />
        <Link
          href="/dashboard/accounting"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
        >
          Open accounting <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Cash"
          value={books.data ? formatMoney(books.data.cash, books.data.decimals, books.data.currency) : '—'}
          meta="1010 · asset"
          icon={<CircleDollarSign className="h-4 w-4" />}
        />
        <Stat
          label="Receivables"
          value={books.data ? formatMoney(books.data.receivable, books.data.decimals, books.data.currency) : '—'}
          meta="Customer invoices outstanding"
          icon={<FileText className="h-4 w-4" />}
        />
        <Stat
          label="Payables"
          value={books.data ? formatMoney(books.data.payable, books.data.decimals, books.data.currency) : '—'}
          meta="Approved bills unpaid"
          icon={<Clock className="h-4 w-4" />}
        />
        <Stat
          label="Net income"
          value={books.data ? formatMoney(books.data.netIncome, books.data.decimals, books.data.currency) : '—'}
          meta={books.data ? `Revenue ${formatMoney(books.data.revenue, books.data.decimals, books.data.currency)}` : 'This month'}
          icon={<Wallet className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="self-start overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <SectionTitle title="Recent bills" hint="Newest first" />
            <Link
              href="/dashboard/invoices"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
            >
              All invoices <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {invoices.loading ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
              <Spinner /> Loading bills
            </div>
          ) : invoices.error ? (
            <ErrorState message={invoices.error} onRetry={() => void invoices.reload()} />
          ) : demoEmpty ? (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title="No bills yet"
              body="Load demo data to explore the approval and payment flow, or create your first vendor bill."
              action={
                <Button variant="secondary" loading={seeding} onClick={() => void seed()}>
                  Load demo data
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-line">
              {(invoices.data ?? []).slice(0, 6).map((invoice) => (
                <Link
                  key={invoice._id}
                  href={`/dashboard/invoices/${invoice._id}`}
                  className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-paper/70"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-num text-[13px] font-medium">{invoice.number}</p>
                    <p className="text-[11px] text-muted">Due {formatDate(invoice.dueDate)}</p>
                  </div>
                  <p className="font-num text-[13px]">
                    {formatMoney(invoice.total, invoice.decimals, invoice.currency)}
                  </p>
                  <StatusPill status={invoice.status} />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle title="Status mix" hint="Across all invoices" />
            <div className="mt-4 space-y-2.5">
              {['DRAFT', 'SUBMITTED', 'APPROVED', 'PAYMENT_PENDING', 'PAID'].map((status) => {
                const count = (invoices.data ?? []).filter((row) => row.status === status).length;
                const total = invoices.data?.length || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={status}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="text-muted">{humanize(status)}</span>
                      <span className="font-num text-muted">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-paper">
                      <div
                        className="h-full rounded-full bg-ink/70"
                        style={{ width: `${Math.max(pct, count > 0 ? 6 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-brand" />
              <p className="text-sm font-semibold">Ask the assistant</p>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              &ldquo;What is waiting for approval?&rdquo; or &ldquo;pay INV-1001&rdquo; — it drafts
              proposals, never moves funds.
            </p>
            <Link
              href="/dashboard/chat"
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
            >
              Open assistant <ArrowUpRight className="h-3 w-3" />
            </Link>
          </Card>

          {agent.data?.accountId ? (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Agent wallet</p>
                <Badge
                  className={
                    agent.data.active
                      ? 'border-mint/20 bg-mint-soft text-mint'
                      : 'border-line bg-paper text-muted'
                  }
                  dot
                >
                  {agent.data.active ? 'Active' : 'Paused'}
                </Badge>
              </div>
              <p className="font-num mt-2 truncate text-[12px] text-muted">{agent.data.accountId}</p>
              <Link
                href="/dashboard/agent"
                className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
              >
                Manage policy <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  meta,
  icon,
}: {
  label: string;
  value: string;
  meta: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between text-muted">
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
        <span className="rounded-lg bg-paper p-1.5">{icon}</span>
      </div>
      <p className="font-num mt-3 text-[26px] font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-muted">{meta}</p>
    </Card>
  );
}
