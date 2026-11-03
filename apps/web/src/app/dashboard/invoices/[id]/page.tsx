'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  CircleSlash,
  FileText,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { Button, Card, SectionTitle, Spinner, StatusPill } from '@/components/ui';
import { PayPanel } from '@/components/pay-panel';

interface Invoice {
  _id: string;
  number: string;
  status: string;
  total: string;
  subtotal: string;
  taxAmount: string;
  taxBps: number;
  decimals: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  vendorId: string;
  lineItems: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
  }>;
  approvals: Array<{
    accountId: string;
    decision: string;
    comment?: string;
    at: string;
  }>;
  paidAt?: string;
}
interface Vendor {
  _id: string;
  name: string;
  email: string;
  payoutChain: string;
  payoutAddress: string;
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const invoice = useApi<Invoice>(id ? `/invoices/${id}` : null);
  const vendors = useApi<Vendor[]>('/vendors');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { session } = useAuth();
  const role = session?.role ?? 'MEMBER';
  const canApprove = ['APPROVER', 'ADMIN', 'OWNER'].includes(role);
  const canAdmin = ['ADMIN', 'OWNER'].includes(role);

  const vendor = vendors.data?.find((item) => item._id === invoice.data?.vendorId);

  async function act(action: 'submit' | 'approve' | 'reject' | 'void') {
    if (!invoice.data) return;
    if (action === 'void' && !window.confirm('Void this invoice?')) return;
    if (action === 'reject' && !window.confirm('Reject this invoice?')) return;
    setBusy(action);
    setError(null);
    try {
      if (action === 'submit') {
        await api(`/invoices/${id}/submit`, { method: 'POST' });
      } else if (action === 'void') {
        await api(`/invoices/${id}/void`, { method: 'POST' });
      } else {
        await api(`/invoices/${id}/decision`, {
          method: 'POST',
          body: JSON.stringify({
            decision: action === 'approve' ? 'APPROVE' : 'REJECT',
          }),
        });
      }
      await invoice.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  if (invoice.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading invoice
      </div>
    );
  }

  if (!invoice.data) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-semibold">Invoice not found</p>
        <p className="mt-1 text-sm text-muted">It may belong to another workspace.</p>
        <Button className="mt-4" variant="secondary" onClick={() => router.push('/dashboard/invoices')}>
          Back to invoices
        </Button>
      </Card>
    );
  }

  const data = invoice.data;
  const canSubmit = data.status === 'DRAFT';
  const canDecide = data.status === 'SUBMITTED' && canApprove;
  const canPay = data.status === 'APPROVED';
  const canVoid = canAdmin && !['PAID', 'VOID'].includes(data.status);

  return (
    <div>
      <Link
        href="/dashboard/invoices"
        className="mb-5 inline-flex items-center gap-1.5 text-[12px] text-muted transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Invoices
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-num text-2xl font-semibold tracking-tight">{data.number}</h1>
            <StatusPill status={data.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {vendor?.name ?? 'Unknown vendor'} · issued {formatDate(data.issueDate)} · due{' '}
            {formatDate(data.dueDate)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted">Total</p>
          <p className="font-num text-2xl font-semibold">
            {formatMoney(data.total, data.decimals, data.currency)}
          </p>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <SectionTitle title="Line items" hint={`${data.lineItems.length} item(s)`} />
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wider text-muted">
                  <th className="px-5 py-2.5 font-medium">Description</th>
                  <th className="px-5 py-2.5 text-right font-medium">Qty</th>
                  <th className="px-5 py-2.5 text-right font-medium">Unit</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.lineItems.map((line, index) => (
                  <tr key={index}>
                    <td className="px-5 py-3 text-[13px]">{line.description}</td>
                    <td className="font-num px-5 py-3 text-right text-[12px] text-muted">
                      {line.quantity}
                    </td>
                    <td className="font-num px-5 py-3 text-right text-[12px] text-muted">
                      {line.unitPrice}
                    </td>
                    <td className="font-num px-5 py-3 text-right text-[13px]">
                      {formatMoney(line.lineTotal, data.decimals, data.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="space-y-1.5 border-t border-line px-5 py-4 text-[12px]">
              <div className="flex justify-between text-muted">
                <span>Subtotal</span>
                <span className="font-num">
                  {formatMoney(data.subtotal, data.decimals, data.currency)}
                </span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Tax ({(data.taxBps / 100).toFixed(2)}%)</span>
                <span className="font-num">
                  {formatMoney(data.taxAmount, data.decimals, data.currency)}
                </span>
              </div>
              <div className="flex justify-between border-t border-line pt-2 text-[13px] font-semibold">
                <span>Total</span>
                <span className="font-num">
                  {formatMoney(data.total, data.decimals, data.currency)}
                </span>
              </div>
            </div>
          </Card>

          {data.notes ? (
            <Card className="p-5">
              <SectionTitle title="Notes" />
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                {data.notes}
              </p>
            </Card>
          ) : null}

          <Card className="p-5">
            <SectionTitle title="Approval trail" hint="Append-only record" />
            {data.approvals.length === 0 ? (
              <p className="mt-3 text-[12px] text-muted">No decisions recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {data.approvals.map((approval, index) => (
                  <li key={index} className="flex items-start gap-2.5">
                    <span
                      className={
                        approval.decision === 'APPROVE'
                          ? 'mt-0.5 grid h-4 w-4 place-items-center rounded-full bg-mint text-white'
                          : 'mt-0.5 grid h-4 w-4 place-items-center rounded-full bg-rose text-white'
                      }
                    >
                      {approval.decision === 'APPROVE' ? (
                        <Check className="h-2.5 w-2.5" />
                      ) : (
                        <X className="h-2.5 w-2.5" />
                      )}
                    </span>
                    <div>
                      <p className="text-[12px] font-medium">
                        {humanize(approval.decision)} ·{' '}
                        <span className="font-num text-muted">{approval.accountId}</span>
                      </p>
                      <p className="text-[10px] text-muted">
                        {new Date(approval.at).toLocaleString('en-US')}
                      </p>
                      {approval.comment ? (
                        <p className="mt-0.5 text-[11px] text-muted">{approval.comment}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {canSubmit || canDecide || canVoid ? (
            <Card className="p-5">
              <SectionTitle title="Next action" hint="Role-checked server-side" />
              <div className="mt-3 space-y-2">
                {canSubmit ? (
                  <Button
                    className="w-full"
                    loading={busy === 'submit'}
                    onClick={() => void act('submit')}
                  >
                    Submit for approval
                  </Button>
                ) : null}
                {canDecide ? (
                  <>
                    <Button
                      className="w-full"
                      loading={busy === 'approve'}
                      onClick={() => void act('approve')}
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      variant="secondary"
                      className="w-full"
                      loading={busy === 'reject'}
                      onClick={() => void act('reject')}
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </>
                ) : null}
                {canVoid ? (
                  <Button
                    variant="ghost"
                    className="w-full"
                    loading={busy === 'void'}
                    onClick={() => void act('void')}
                  >
                    <CircleSlash className="h-3.5 w-3.5" /> Void invoice
                  </Button>
                ) : null}
                {data.status === 'PAID' ? (
                  <p className="flex items-center gap-1.5 text-[12px] text-mint">
                    <ShieldCheck className="h-3.5 w-3.5" /> Paid
                    {data.paidAt ? ` on ${formatDate(data.paidAt)}` : ''}
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {vendor ? (
            <Card className="p-5">
              <SectionTitle title="Vendor" />
              <p className="mt-2 text-[13px] font-medium">{vendor.name}</p>
              <p className="text-[11px] text-muted">{vendor.email}</p>
              <div className="mt-3 rounded-xl bg-paper px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-muted">Payout</p>
                <p className="mt-0.5 text-[12px] font-medium capitalize">{vendor.payoutChain}</p>
                <p className="font-num mt-0.5 truncate text-[11px] text-muted">
                  {vendor.payoutAddress}
                </p>
              </div>
            </Card>
          ) : null}

          {canPay || data.status === 'PAYMENT_PENDING' || data.status === 'PAID' ? (
            <PayPanel
              invoiceId={data._id}
              disabled={!canPay && data.status !== 'PAYMENT_PENDING'}
              onChanged={() => void invoice.reload()}
            />
          ) : (
            <Card className="p-5">
              <div className="flex items-center gap-2 text-muted">
                <FileText className="h-4 w-4" />
                <p className="text-[12px]">
                  Settlement unlocks once the invoice is approved.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
