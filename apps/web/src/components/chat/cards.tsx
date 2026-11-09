'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Building2,
  Check,
  CreditCard,
  FileText,
  Landmark,
  ListChecks,
  Receipt,
  ScrollText,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import type {
  ChatApprovalRequest,
  ChatCard,
  ChatMoney,
  ChatPlan,
  ChatRisk,
} from '@keiz/shared';
import { Badge, Button, Spinner, StatusPill } from '@/components/ui';
import { formatDate, humanize } from '@/lib/format';
import { cn } from '@/lib/utils';

function amount(money: ChatMoney | undefined): string {
  if (!money) return '—';
  return `${money.currency} ${money.formatted}`.trim();
}

function RiskBadge({ risk }: { risk: ChatRisk }) {
  const tone =
    risk === 'spend'
      ? 'bg-rose-soft text-rose'
      : risk === 'write'
        ? 'bg-amber-soft text-amber'
        : 'bg-paper text-muted';
  return <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', tone)}>{risk}</span>;
}

function CardShell({
  card,
  children,
}: {
  card: ChatCard;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold">{card.title}</p>
          {card.subtitle ? (
            <p className="mt-0.5 truncate text-[10px] text-muted">{card.subtitle}</p>
          ) : null}
        </div>
        <Link
          href={card.link.href}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-medium text-brand transition hover:bg-brand-soft"
        >
          {card.link.label} <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="px-3 py-2.5">{children}</div>
      {card.relatedLinks?.length ? (
        <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2">
          {card.relatedLinks.map((link) => (
            <Link
              key={`${link.href}-${link.label}`}
              href={link.href}
              className="text-[10px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyRows({ label }: { label: string }) {
  return <p className="py-2 text-[11px] text-muted">{label}</p>;
}

function RowLink({
  href,
  title,
  meta,
  right,
}: {
  href: string;
  title: string;
  meta?: string;
  right?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition hover:bg-paper"
    >
      <span className="min-w-0">
        <span className="block truncate font-num text-[11px] font-medium">{title}</span>
        {meta ? <span className="block truncate text-[10px] text-muted">{meta}</span> : null}
      </span>
      <span className="shrink-0 text-right text-[10px] text-muted">{right}</span>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-paper px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted">{label}</p>
      <p className="font-num mt-0.5 text-[13px] font-semibold">{value}</p>
    </div>
  );
}

export function ChatCardView({ card }: { card: ChatCard }) {
  switch (card.kind) {
    case 'plan':
      return null;

    case 'invoice-list':
      return (
        <CardShell card={card}>
          {card.data.invoices.length === 0 ? (
            <EmptyRows label="No bills match this view." />
          ) : (
            <div className="space-y-0.5">
              {card.data.invoices.map((invoice) => (
                <RowLink
                  key={invoice.id}
                  href={invoice.link.href}
                  title={invoice.number}
                  meta={`${invoice.vendorName ?? 'Unknown vendor'} · due ${formatDate(invoice.dueDate)}`}
                  right={
                    <span className="flex items-center gap-1.5">
                      <StatusPill status={invoice.status} />
                      <span className="font-num">{amount(invoice.total)}</span>
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </CardShell>
      );

    case 'invoice': {
      const invoice = card.data.invoice;
      return (
        <CardShell card={card}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Status" value={humanize(invoice.status)} />
            <Stat label="Total" value={amount(invoice.total)} />
            <Stat label="Due" value={formatDate(invoice.dueDate)} />
            <Stat label="Lines" value={String(invoice.lineCount)} />
          </div>
          {card.data.lines.length ? (
            <div className="mt-2.5 space-y-1 border-t border-line pt-2">
              {card.data.lines.map((line, index) => (
                <div key={index} className="flex justify-between gap-2 text-[10px]">
                  <span className="min-w-0 truncate">{line.description}</span>
                  <span className="font-num shrink-0 text-muted">{amount(line.lineTotal)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {card.data.approvals.length ? (
            <div className="mt-2 space-y-0.5 border-t border-line pt-2 text-[10px] text-muted">
              {card.data.approvals.map((approval, index) => (
                <p key={index}>
                  {humanize(approval.decision)} · {approval.accountId} ·{' '}
                  {formatDate(approval.at)}
                </p>
              ))}
            </div>
          ) : null}
        </CardShell>
      );
    }

    case 'spend-summary':
      return (
        <CardShell card={card}>
          {card.data.byStatus.length === 0 ? (
            <EmptyRows label="No invoices yet." />
          ) : (
            <div className="space-y-1">
              {card.data.byStatus.map((row, index) => (
                <div key={`${row.status}-${row.currency}-${index}`} className="flex justify-between text-[11px]">
                  <span>
                    {humanize(row.status)} <span className="text-muted">· {row.count}</span>
                  </span>
                  <span className="font-num">{amount(row.total)}</span>
                </div>
              ))}
              <p className="pt-1 text-[10px] text-muted">{card.data.vendorCount} active vendor(s)</p>
            </div>
          )}
        </CardShell>
      );

    case 'books-summary': {
      const data = card.data;
      return (
        <CardShell card={card}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Cash" value={amount(data.cash)} />
            <Stat label="Receivable" value={amount(data.receivable)} />
            <Stat label="Payable" value={amount(data.payable)} />
            <Stat label="Revenue" value={amount(data.revenue)} />
            <Stat label="Expenses" value={amount(data.expenses)} />
            <Stat label="Net income" value={amount(data.netIncome)} />
          </div>
          <p className="mt-2 text-[10px] text-muted">
            Trial balance:{' '}
            <span className={data.trialBalance.totals.balanced ? 'text-mint' : 'text-rose'}>
              {data.trialBalance.totals.balanced ? 'balanced' : 'out of balance'}
            </span>
          </p>
        </CardShell>
      );
    }

    case 'vendor-list':
      return (
        <CardShell card={card}>
          {card.data.vendors.length === 0 ? (
            <EmptyRows label="No vendors yet." />
          ) : (
            <div className="space-y-0.5">
              {card.data.vendors.map((vendor) => (
                <RowLink
                  key={vendor.id}
                  href={vendor.link.href}
                  title={vendor.name}
                  meta={`${vendor.payoutChain} · ${vendor.payoutAddress}`}
                  right={<Badge>{humanize(vendor.status)}</Badge>}
                />
              ))}
            </div>
          )}
        </CardShell>
      );

    case 'vendor':
      return (
        <CardShell card={card}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Payout chain" value={card.data.vendor.payoutChain} />
            <Stat label="Status" value={humanize(card.data.vendor.status)} />
          </div>
          <p className="mt-2 break-all font-num text-[10px] text-muted">
            {card.data.vendor.payoutAddress}
          </p>
          {card.data.bills?.length ? (
            <div className="mt-2 space-y-0.5 border-t border-line pt-2">
              {card.data.bills.map((bill) => (
                <RowLink
                  key={bill.id}
                  href={bill.link.href}
                  title={bill.number}
                  meta={humanize(bill.status)}
                  right={amount(bill.total)}
                />
              ))}
            </div>
          ) : null}
        </CardShell>
      );

    case 'customer-list':
      return (
        <CardShell card={card}>
          {card.data.customers.length === 0 ? (
            <EmptyRows label="No customers yet." />
          ) : (
            <div className="space-y-0.5">
              {card.data.customers.map((customer) => (
                <RowLink
                  key={customer.id}
                  href={customer.link.href}
                  title={customer.name}
                  meta={customer.email}
                  right={<Badge>{humanize(customer.status)}</Badge>}
                />
              ))}
            </div>
          )}
        </CardShell>
      );

    case 'customer':
      return (
        <CardShell card={card}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Email" value={card.data.customer.email} />
            <Stat label="Status" value={humanize(card.data.customer.status)} />
          </div>
          {card.data.receivables?.length ? (
            <div className="mt-2 space-y-0.5 border-t border-line pt-2">
              {card.data.receivables.map((row) => (
                <RowLink
                  key={row.id}
                  href={row.link.href}
                  title={row.number}
                  meta={humanize(row.status)}
                  right={amount(row.outstanding)}
                />
              ))}
            </div>
          ) : null}
        </CardShell>
      );

    case 'receivable-list':
      return (
        <CardShell card={card}>
          {card.data.receivables.length === 0 ? (
            <EmptyRows label="No customer invoices yet." />
          ) : (
            <div className="space-y-0.5">
              {card.data.receivables.map((row) => (
                <RowLink
                  key={row.id}
                  href={row.link.href}
                  title={row.number}
                  meta={`${row.customerName ?? 'Unknown customer'} · due ${formatDate(row.dueDate)}`}
                  right={
                    <span className="flex items-center gap-1.5">
                      <StatusPill status={row.status} />
                      <span className="font-num">{amount(row.outstanding)}</span>
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </CardShell>
      );

    case 'receivable': {
      const row = card.data.receivable;
      return (
        <CardShell card={card}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Status" value={humanize(row.status)} />
            <Stat label="Total" value={amount(row.total)} />
            <Stat label="Paid" value={amount(row.paid)} />
            <Stat label="Outstanding" value={amount(row.outstanding)} />
          </div>
          {card.data.receipts.length ? (
            <div className="mt-2 space-y-0.5 border-t border-line pt-2 text-[10px]">
              {card.data.receipts.map((receipt) => (
                <div key={receipt.receiptId} className="flex justify-between gap-2">
                  <span className="truncate text-muted">
                    {humanize(receipt.method)} · {formatDate(receipt.receivedAt)}
                  </span>
                  <span className="font-num shrink-0">{amount(receipt.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </CardShell>
      );
    }

    case 'payment-list':
      return (
        <CardShell card={card}>
          {card.data.payments.length === 0 ? (
            <EmptyRows label="No payments yet." />
          ) : (
            <div className="space-y-0.5">
              {card.data.payments.map((payment) => (
                <RowLink
                  key={payment.id}
                  href={payment.link.href}
                  title={payment.invoiceNumber ?? payment.id.slice(-8)}
                  meta={`${payment.provider} · ${payment.payer}`}
                  right={
                    <span className="flex items-center gap-1.5">
                      <StatusPill status={payment.status} />
                      <span className="font-num">{amount(payment.amountOut ?? payment.amountIn)}</span>
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </CardShell>
      );

    case 'payment': {
      const payment = card.data.payment;
      return (
        <CardShell card={card}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Status" value={humanize(payment.status)} />
            <Stat label="Provider" value={payment.provider} />
            <Stat label="In" value={amount(payment.amountIn)} />
            <Stat label="Out" value={amount(payment.amountOut)} />
          </div>
          {payment.depositAddress ? (
            <p className="mt-2 break-all font-num text-[10px] text-muted">
              Deposit: {payment.depositAddress}
            </p>
          ) : null}
          {card.data.events.length ? (
            <div className="mt-2 space-y-0.5 border-t border-line pt-2 text-[10px] text-muted">
              {card.data.events.slice(-6).map((event) => (
                <p key={event.id}>
                  {formatDate(event.at)} · {humanize(event.status)}
                  {event.rawStatus ? ` · ${event.rawStatus}` : ''}
                </p>
              ))}
            </div>
          ) : null}
        </CardShell>
      );
    }

    case 'agent-action-list':
      return (
        <CardShell card={card}>
          {card.data.actions.length === 0 ? (
            <EmptyRows label="No agent actions yet." />
          ) : (
            <div className="space-y-0.5">
              {card.data.actions.map((action) => (
                <RowLink
                  key={action.id}
                  href={action.link.href}
                  title={`$${action.amountUsd} · ${action.asset}`}
                  meta={formatDate(action.createdAt)}
                  right={<StatusPill status={action.status} />}
                />
              ))}
            </div>
          )}
        </CardShell>
      );

    case 'agent-action':
      return (
        <CardShell card={card}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Status" value={humanize(card.data.action.status)} />
            <Stat label="Amount" value={`$${card.data.action.amountUsd}`} />
          </div>
          <p className="mt-2 break-all font-num text-[10px] text-muted">
            {card.data.action.asset}
          </p>
        </CardShell>
      );

    case 'journal-list':
      return (
        <CardShell card={card}>
          {card.data.entries.length === 0 ? (
            <EmptyRows label="No journal entries yet." />
          ) : (
            <div className="space-y-1.5">
              {card.data.entries.map((entry) => (
                <Link
                  key={entry.id}
                  href={entry.link.href}
                  className="block rounded-lg px-2 py-1.5 transition hover:bg-paper"
                >
                  <div className="flex justify-between gap-2 text-[11px]">
                    <span className="truncate font-medium">{entry.memo}</span>
                    <span className="shrink-0 text-[10px] text-muted">
                      {formatDate(entry.date)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted">
                    {entry.sourceType} · {entry.event} · {entry.currency}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardShell>
      );
  }
}

export function PlanCard({
  plan,
  busy,
  onApprove,
  onDecline,
}: {
  plan: ChatPlan;
  busy?: boolean;
  onApprove?: () => void;
  onDecline?: () => void;
}) {
  const pending = plan.status === 'pending';
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <ListChecks className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[12px] font-semibold">Action plan</p>
            <Badge
              className={cn(
                plan.status === 'approved' && 'bg-mint-soft text-mint',
                plan.status === 'declined' && 'bg-rose-soft text-rose',
              )}
            >
              {humanize(plan.status)}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted">{plan.goal}</p>
        </div>
      </div>
      <ol className="space-y-1.5 px-3 py-2.5">
        {plan.steps.map((step, index) => (
          <li key={index} className="flex gap-2">
            <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-paper font-num text-[9px] text-muted">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-medium">{step.title}</span>
              {step.detail ? (
                <span className="block text-[10px] text-muted">{step.detail}</span>
              ) : null}
              <span className="mt-0.5 flex items-center gap-1.5">
                <RiskBadge risk={step.risk} />
                {step.tool ? (
                  <span className="font-num text-[9px] text-muted">{step.tool}</span>
                ) : null}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {pending && onApprove && onDecline ? (
        <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">
          <Button size="sm" variant="secondary" onClick={onDecline} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={onApprove} disabled={busy}>
            {busy ? <Spinner className="h-3 w-3" /> : <Check className="h-3 w-3" />} Approve plan
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ApprovalCard({
  approval,
  busy,
  resolved,
  onApprove,
  onDecline,
}: {
  approval: ChatApprovalRequest;
  busy?: boolean;
  resolved?: { approved: boolean; reason?: string };
  onApprove: () => void;
  onDecline: (reason?: string) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-amber-soft text-amber">
          <ShieldAlert className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[12px] font-semibold">Confirm tool call</p>
            <RiskBadge risk={approval.risk} />
          </div>
          <p className="mt-0.5 text-[11px] text-muted">{approval.summary}</p>
          <p className="font-num mt-0.5 text-[9px] text-muted/70">{approval.name}</p>
        </div>
      </div>
      <details className="px-3 py-2">
        <summary className="cursor-pointer text-[10px] text-muted">Arguments</summary>
        <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-paper p-2 text-[9px] leading-relaxed text-muted scroll-thin">
          {JSON.stringify(approval.args, null, 2)}
        </pre>
      </details>
      {resolved ? (
        <div className="border-t border-line px-3 py-2 text-[10px]">
          <span className={resolved.approved ? 'text-mint' : 'text-rose'}>
            {resolved.approved ? 'Approved' : 'Declined'}
          </span>
          {resolved.reason ? <span className="text-muted"> · {resolved.reason}</span> : null}
        </div>
      ) : declining ? (
        <div className="space-y-2 border-t border-line px-3 py-2">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why decline? (optional)"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] outline-none focus:border-brand"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDeclining(false)} disabled={busy}>
              Back
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onDecline(reason.trim() || undefined)}
              disabled={busy}
            >
              Decline
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDeclining(true)}
            disabled={busy}
          >
            <X className="h-3 w-3" /> Decline
          </Button>
          <Button size="sm" onClick={onApprove} disabled={busy}>
            {busy ? <Spinner className="h-3 w-3" /> : <Check className="h-3 w-3" />} Approve
          </Button>
        </div>
      )}
    </div>
  );
}

/** Small visual hint used by the empty state and history. */
export function CardKindIcon({ kind }: { kind: ChatCard['kind'] }) {
  const Icon =
    kind.startsWith('invoice')
      ? FileText
      : kind.startsWith('receivable')
        ? Receipt
        : kind.startsWith('vendor')
          ? Building2
          : kind.startsWith('customer')
            ? Users
            : kind.startsWith('payment')
              ? CreditCard
              : kind.startsWith('agent')
                ? Landmark
                : kind.startsWith('journal')
                  ? ScrollText
                  : BookOpen;
  return <Icon className="h-3.5 w-3.5" />;
}
