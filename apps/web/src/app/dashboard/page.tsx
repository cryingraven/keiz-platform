'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  Receipt,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDollars, formatMoney, timeLeft } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import {
  DirectEntryForm,
  type AccountOption,
  type DirectEntryKind,
} from '@/components/direct-entry-form';
import { Alert, Button, ButtonLink, Card, EmptyState, ErrorState, SectionTitle, Spinner, StatusPill } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Invoice {
  _id: string;
  number: string;
  status: string;
  total: string;
  decimals: number;
  currency: string;
  dueDate: string;
  vendorId: string;
}

interface Payment {
  _id: string;
  status: string;
  invoiceId?: string;
  amountOutFormatted?: string;
  deadline?: string;
}

interface Receivable {
  _id: string;
  number: string;
  status: string;
  total: string;
  paidAmount: string;
  decimals: number;
  currency: string;
  dueDate: string;
  customerId: string;
}

interface Vendor {
  _id: string;
  name: string;
}

interface Customer {
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

function daysUntil(value: string): number {
  const due = new Date(value);
  due.setUTCHours(0, 0, 0, 0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function dueLabel(value: string): string {
  const days = daysUntil(value);
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 7) return `Due in ${days} days`;
  return `Due ${formatDate(value)}`;
}

interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  href: string;
  tag: string;
  tone: 'danger' | 'warning' | 'info';
}

export default function TodayPage() {
  const { session } = useAuth();
  const invoices = useApi<Invoice[]>('/invoices');
  const payments = useApi<Payment[]>('/payments/open', { pollMs: 5000 });
  const receivables = useApi<Receivable[]>('/receivables');
  const vendors = useApi<Vendor[]>('/vendors');
  const customers = useApi<Customer[]>('/customers');
  const books = useApi<Books>('/accounting/summary?currency=USD');
  const accounts = useApi<AccountOption[]>('/accounting/accounts');
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [directKind, setDirectKind] = useState<DirectEntryKind | null>(null);

  const canApprove = ['APPROVER', 'ADMIN', 'OWNER'].includes(session?.role ?? '');
  const canWriteBooks = session?.role === 'ADMIN' || session?.role === 'OWNER';

  const names = useMemo(() => {
    const vendorNames = new Map<string, string>();
    (vendors.data ?? []).forEach((vendor) => vendorNames.set(vendor._id, vendor.name));
    const customerNames = new Map<string, string>();
    (customers.data ?? []).forEach((customer) => customerNames.set(customer._id, customer.name));
    return { vendorNames, customerNames };
  }, [vendors.data, customers.data]);

  const waitingForApproval = useMemo(
    () => (invoices.data ?? []).filter((invoice) => invoice.status === 'SUBMITTED'),
    [invoices.data],
  );

  const attention = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    const rows = invoices.data ?? [];

    rows
      .filter((invoice) => invoice.status === 'APPROVED' && daysUntil(invoice.dueDate) < 0)
      .forEach((invoice) => {
        items.push({
          key: `overdue-${invoice._id}`,
          title: `${invoice.number} is approved and overdue`,
          detail: `${names.vendorNames.get(invoice.vendorId) ?? 'Vendor'} · ${dueLabel(invoice.dueDate)}`,
          href: `/dashboard/invoices/${invoice._id}`,
          tag: 'Pay it',
          tone: 'danger',
        });
      });

    waitingForApproval.forEach((invoice) => {
      items.push({
        key: `approve-${invoice._id}`,
        title: `${invoice.number} needs ${canApprove ? 'your approval' : 'an approver'}`,
        detail: `${names.vendorNames.get(invoice.vendorId) ?? 'Vendor'} · ${formatMoney(
          invoice.total,
          invoice.decimals,
          invoice.currency,
        )}`,
        href: `/dashboard/invoices/${invoice._id}`,
        tag: canApprove ? 'Review' : 'View',
        tone: 'warning',
      });
    });

    (payments.data ?? [])
      .filter((payment) => payment.status === 'AWAITING_DEPOSIT')
      .forEach((payment) => {
        items.push({
          key: `deposit-${payment._id}`,
          title: 'A payment is waiting for a deposit',
          detail: payment.deadline ? `Quote ${timeLeft(payment.deadline)} left` : 'Deposit address issued',
          href: '/dashboard/payments',
          tag: 'Deposit',
          tone: 'warning',
        });
      });

    (receivables.data ?? [])
      .filter(
        (row) =>
          ['ISSUED', 'PARTIALLY_PAID'].includes(row.status) && daysUntil(row.dueDate) < 0,
      )
      .forEach((row) => {
        items.push({
          key: `ar-${row._id}`,
          title: `${row.number} is past due`,
          detail: `${names.customerNames.get(row.customerId) ?? 'Customer'} · ${dueLabel(row.dueDate)}`,
          href: `/dashboard/receivables/${row._id}`,
          tag: 'Follow up',
          tone: 'info',
        });
      });

    return items.slice(0, 6);
  }, [invoices.data, payments.data, receivables.data, names, canApprove]);

  const summary = useMemo(() => {
    const rows = invoices.data ?? [];
    const usd = rows.filter((row) => row.currency === 'USD');
    const outstanding = usd
      .filter((row) => OPEN_STATUSES.includes(row.status))
      .reduce((sum, row) => sum + Number(row.total) / 10 ** row.decimals, 0);
    return {
      outstanding,
      awaiting: usd.filter((row) => row.status === 'SUBMITTED').length,
    };
  }, [invoices.data]);

  const recent = useMemo(() => (invoices.data ?? []).slice(0, 6), [invoices.data]);

  const dueSoon = useMemo(
    () =>
      (invoices.data ?? [])
        .filter((invoice) => invoice.status === 'APPROVED')
        .filter((invoice) => {
          const days = daysUntil(invoice.dueDate);
          return days >= 0 && days <= 7;
        })
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
        .slice(0, 4),
    [invoices.data],
  );

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
        receivables.reload(),
        customers.reload(),
        books.reload(),
      ]);
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Could not load the demo data');
    } finally {
      setSeeding(false);
    }
  }

  const today = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const money = (value?: string) =>
    books.data && value !== undefined
      ? formatMoney(value, books.data.decimals, books.data.currency)
      : '—';

  return (
    <div>
      <PageHeader
        title="Today"
        description={today}
        actions={
          <>
            {demoEmpty ? (
              <Button variant="secondary" loading={seeding} onClick={() => void seed()}>
                Load demo data
              </Button>
            ) : null}
            {canWriteBooks ? (
              <>
                <Button variant="secondary" onClick={() => setDirectKind('EXPENSE')}>
                  <Receipt className="h-3.5 w-3.5" /> New expense
                </Button>
                <Button variant="secondary" onClick={() => setDirectKind('REVENUE')}>
                  <TrendingUp className="h-3.5 w-3.5" /> New revenue
                </Button>
              </>
            ) : null}
            <ButtonLink href="/dashboard/invoices">
              <Plus className="h-3.5 w-3.5" /> New bill
            </ButtonLink>
          </>
        }
      />

      {seedError ? (
        <Alert tone="danger" className="mb-4" onDismiss={() => setSeedError(null)}>
          {seedError}
        </Alert>
      ) : null}

      <section aria-labelledby="attention-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 id="attention-heading" className="text-ui font-semibold">
              Needs attention
            </h2>
            <p className="mt-0.5 text-small text-muted">
              {attention.length === 0
                ? 'Nothing is waiting on you right now.'
                : `${attention.length} item${attention.length === 1 ? '' : 's'} worth a look.`}
            </p>
          </div>
          {summary.awaiting > 0 ? (
            <Link
              href="/dashboard/invoices?status=SUBMITTED"
              className="inline-flex items-center gap-1 text-small font-medium text-brand hover:underline"
            >
              All approvals <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>

        <Card className="overflow-hidden">
          {invoices.loading && !invoices.data ? (
            <div className="flex items-center gap-2 px-5 py-8 text-ui text-muted">
              <Spinner /> Looking for work
            </div>
          ) : invoices.error ? (
            <ErrorState message={invoices.error} onRetry={() => void invoices.reload()} />
          ) : attention.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-6">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mint-soft text-mint">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <div>
                <p className="text-ui font-medium">You are caught up</p>
                <p className="mt-0.5 text-small text-muted">
                  New approvals, deposits and overdue invoices will show up here.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {attention.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-raised"
                  >
                    <span
                      className={cn(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-full',
                        item.tone === 'danger'
                          ? 'bg-rose-soft text-rose'
                          : item.tone === 'warning'
                            ? 'bg-amber-soft text-amber'
                            : 'bg-brand-soft text-brand',
                      )}
                    >
                      {item.tone === 'danger' ? (
                        <AlertCircle className="h-4 w-4" />
                      ) : item.tone === 'warning' ? (
                        <Clock className="h-4 w-4" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-ui font-medium text-ink">{item.title}</p>
                      <p className="truncate text-small text-muted">{item.detail}</p>
                    </div>
                    <span className="hidden shrink-0 text-small font-medium text-brand sm:inline">
                      {item.tag}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="mt-6" aria-labelledby="money-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 id="money-heading" className="text-ui font-semibold">
              Money
            </h2>
            <p className="mt-0.5 text-small text-muted">
              {summary.awaiting > 0
                ? `${formatDollars(summary.outstanding)} USD outstanding · ${summary.awaiting} awaiting approval`
                : 'From the double-entry ledger'}
            </p>
          </div>
          <Link
            href="/dashboard/accounting"
            className="inline-flex items-center gap-1 text-small font-medium text-brand hover:underline"
          >
            Open accounting <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-line">
          <MoneyCell label="Cash" value={money(books.data?.cash)} hint="1010 · asset" loading={books.loading} />
          <MoneyCell
            label="Receivables"
            value={money(books.data?.receivable)}
            hint="Customer invoices open"
            loading={books.loading}
          />
          <MoneyCell
            label="Payables"
            value={money(books.data?.payable)}
            hint="Approved bills unpaid"
            loading={books.loading}
          />
          <MoneyCell
            label="Net income"
            value={money(books.data?.netIncome)}
            hint={books.data ? `Revenue ${formatMoney(books.data.revenue, books.data.decimals, books.data.currency)}` : 'This period'}
            loading={books.loading}
          />
        </Card>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="self-start overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <SectionTitle title="Recent bills" hint="Newest first" />
            <Link
              href="/dashboard/invoices"
              className="inline-flex items-center gap-1 text-small font-medium text-brand hover:underline"
            >
              All bills <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {demoEmpty ? (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title="No bills yet"
              body="Add your first vendor bill, or load demo data to walk through approvals and payments."
              action={
                <div className="flex gap-2">
                  <ButtonLink href="/dashboard/invoices" size="sm">
                    <Plus className="h-3.5 w-3.5" /> New bill
                  </ButtonLink>
                  <Button size="sm" variant="secondary" loading={seeding} onClick={() => void seed()}>
                    Load demo data
                  </Button>
                </div>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((invoice) => {
                const overdue =
                  !['PAID', 'DRAFT', 'VOID'].includes(invoice.status) &&
                  daysUntil(invoice.dueDate) < 0;
                return (
                  <li key={invoice._id}>
                    <Link
                      href={`/dashboard/invoices/${invoice._id}`}
                      className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-raised"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-num text-ui font-medium">{invoice.number}</p>
                        <p className="truncate text-small text-muted">
                          {names.vendorNames.get(invoice.vendorId) ?? 'Vendor'}
                          <span className={overdue ? ' text-rose' : ''}>
                            {' '}
                            · {overdue ? dueLabel(invoice.dueDate) : `due ${formatDate(invoice.dueDate)}`}
                          </span>
                        </p>
                      </div>
                      <p className="font-num shrink-0 text-ui">
                        {formatMoney(invoice.total, invoice.decimals, invoice.currency)}
                      </p>
                      <span className="hidden shrink-0 sm:inline">
                        <StatusPill status={invoice.status} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <SectionTitle title="Due this week" hint="Approved bills" />
            </div>
            {dueSoon.length === 0 ? (
              <div className="px-5 py-5">
                <p className="text-small text-muted">Nothing is due in the next seven days.</p>
                <Link
                  href="/dashboard/invoices?status=APPROVED"
                  className="mt-2 inline-flex items-center gap-1 text-small font-medium text-brand hover:underline"
                >
                  Review approved bills <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {dueSoon.map((invoice) => (
                  <li key={invoice._id}>
                    <Link
                      href={`/dashboard/invoices/${invoice._id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-raised"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-small font-medium">
                          {names.vendorNames.get(invoice.vendorId) ?? invoice.number}
                        </p>
                        <p className={cn('text-meta', daysUntil(invoice.dueDate) < 0 ? 'text-rose' : 'text-muted')}>
                          {dueLabel(invoice.dueDate)}
                        </p>
                      </div>
                      <p className="font-num shrink-0 text-small">
                        {formatMoney(invoice.total, invoice.decimals, invoice.currency)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="px-5 py-4">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted" />
              <p className="text-ui font-medium">Cash position</p>
            </div>
            <p className="mt-1 text-small leading-relaxed text-muted">
              {books.data
                ? `${formatMoney(books.data.cash, books.data.decimals, books.data.currency)} in cash, ${formatMoney(
                    books.data.payable,
                    books.data.decimals,
                    books.data.currency,
                  )} in approved payables.`
                : 'Loading the ledger summary.'}
            </p>
          </Card>
        </div>
      </div>

      <DirectEntryForm
        open={directKind !== null}
        kind={directKind ?? 'EXPENSE'}
        accounts={accounts.data ?? []}
        onClose={() => setDirectKind(null)}
        onCreated={() => {
          void books.reload();
        }}
      />
    </div>
  );
}

function MoneyCell({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: string;
  hint: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-small text-muted">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-ink/[0.06]" />
      ) : (
        <p className="font-num mt-1 text-[20px] font-semibold tracking-tight">{value}</p>
      )}
      <p className="mt-0.5 truncate text-meta text-muted">{hint}</p>
    </div>
  );
}
