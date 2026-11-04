'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  CircleSlash,
  HandCoins,
  Plus,
  Receipt as ReceiptIcon,
  ShieldCheck,
} from 'lucide-react';
import { formatUnits } from '@keiz/shared';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import {
  Button,
  Card,
  Input,
  Label,
  Modal,
  SectionTitle,
  Select,
  Spinner,
  StatusPill,
} from '@/components/ui';

interface Receipt {
  receiptId: string;
  amount: string;
  currency: string;
  decimals: number;
  receivedAt: string;
  method: string;
  reference?: string;
  txHash?: string;
}

interface Receivable {
  _id: string;
  number: string;
  customerId: string;
  status: string;
  subtotal: string;
  taxAmount: string;
  taxBps: number;
  total: string;
  paidAmount: string;
  decimals: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  lineItems: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
  }>;
  receipts: Receipt[];
  issuedAt?: string;
  voidedAt?: string;
}

interface Customer {
  _id: string;
  name: string;
  email: string;
}

interface JournalEntry {
  _id: string;
  date: string;
  memo: string;
  event: string;
  sourceType: string;
  currency: string;
  decimals: number;
  lines: Array<{
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
  }>;
}

export default function ReceivableDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const receivable = useApi<Receivable>(id ? `/receivables/${id}` : null);
  const customers = useApi<Customer[]>('/customers');
  const ledger = useApi<JournalEntry[]>(
    id ? `/accounting/journal-entries?sourceType=receivable&sourceId=${id}` : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { session } = useAuth();
  const role = session?.role ?? 'MEMBER';
  const canReceipt = ['APPROVER', 'ADMIN', 'OWNER'].includes(role);
  const canAdmin = ['ADMIN', 'OWNER'].includes(role);

  const customer = customers.data?.find((item) => item._id === receivable.data?.customerId);

  async function act(action: 'issue' | 'void') {
    if (!receivable.data) return;
    if (action === 'void' && !window.confirm('Void this customer invoice?')) return;
    setBusy(action);
    setError(null);
    try {
      await api(`/receivables/${id}/${action}`, { method: 'POST' });
      await receivable.reload();
      await ledger.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  if (receivable.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading receivable
      </div>
    );
  }

  if (!receivable.data) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-semibold">Receivable not found</p>
        <p className="mt-1 text-sm text-muted">It may belong to another workspace.</p>
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => router.push('/dashboard/receivables')}
        >
          Back to receivables
        </Button>
      </Card>
    );
  }

  const data = receivable.data;
  const outstanding = BigInt(data.total) - BigInt(data.paidAmount);
  const overdue =
    ['ISSUED', 'PARTIALLY_PAID'].includes(data.status) &&
    new Date(data.dueDate).getTime() < Date.now();
  const canIssue = data.status === 'DRAFT';
  const canRecord = canReceipt && ['ISSUED', 'PARTIALLY_PAID'].includes(data.status);
  const canVoid =
    canAdmin && !['PAID', 'VOID'].includes(data.status) && (data.receipts?.length ?? 0) === 0;

  return (
    <div>
      <Link
        href="/dashboard/receivables"
        className="mb-5 inline-flex items-center gap-1.5 text-[12px] text-muted transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Receivables
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-num text-2xl font-semibold tracking-tight">{data.number}</h1>
            <StatusPill status={overdue ? 'OVERDUE' : data.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {customer?.name ?? 'Unknown customer'} · issued {formatDate(data.issueDate)} · due{' '}
            {formatDate(data.dueDate)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted">Outstanding</p>
          <p className="font-num text-2xl font-semibold">
            {formatMoney(outstanding.toString(), data.decimals, data.currency)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            of {formatMoney(data.total, data.decimals, data.currency)}
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

          <Card className="overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <SectionTitle
                title="Receipts"
                hint={`${data.receipts?.length ?? 0} recorded`}
                action={
                  canRecord ? (
                    <Button size="sm" onClick={() => setReceiptOpen(true)}>
                      <Plus className="h-3 w-3" /> Record receipt
                    </Button>
                  ) : undefined
                }
              />
            </div>
            {(data.receipts?.length ?? 0) === 0 ? (
              <p className="px-5 py-6 text-[12px] text-muted">
                No cash received yet. Issue the invoice first, then record receipts.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wider text-muted">
                    <th className="px-5 py-2.5 font-medium">Received</th>
                    <th className="px-5 py-2.5 font-medium">Method</th>
                    <th className="px-5 py-2.5 font-medium">Reference</th>
                    <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.receipts.map((receipt) => (
                    <tr key={receipt.receiptId}>
                      <td className="px-5 py-3 text-[12px] text-muted">
                        {formatDate(receipt.receivedAt)}
                      </td>
                      <td className="px-5 py-3 text-[12px]">{humanize(receipt.method)}</td>
                      <td className="font-num px-5 py-3 text-[11px] text-muted">
                        {receipt.reference ?? receipt.txHash ?? '—'}
                      </td>
                      <td className="font-num px-5 py-3 text-right text-[13px]">
                        {formatMoney(receipt.amount, receipt.decimals, receipt.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
            <SectionTitle title="Ledger postings" hint="Issue and reversal entries" />
            {ledger.loading ? (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
                <Spinner /> Loading postings
              </div>
            ) : (ledger.data?.length ?? 0) === 0 ? (
              <p className="mt-3 text-[12px] text-muted">
                Nothing posted yet. Issuing the invoice creates the AR entry.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {ledger.data?.map((entry) => (
                  <div key={entry._id} className="rounded-xl border border-line px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-medium">{entry.memo}</p>
                      <span className="text-[10px] uppercase tracking-wider text-muted">
                        {humanize(entry.event)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted">{formatDate(entry.date)}</p>
                    <div className="mt-2 space-y-1">
                      {entry.lines.map((line, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between text-[11px]"
                        >
                          <span className="text-muted">
                            {line.accountCode} · {line.accountName}
                          </span>
                          <span className="font-num">
                            {line.debit !== '0'
                              ? `Dr ${formatMoney(line.debit, entry.decimals, entry.currency)}`
                              : `Cr ${formatMoney(line.credit, entry.decimals, entry.currency)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {canIssue || canRecord || canVoid || data.status === 'PAID' ? (
            <Card className="p-5">
              <SectionTitle title="Next action" hint="Role-checked server-side" />
              <div className="mt-3 space-y-2">
                {canIssue ? (
                  <Button
                    className="w-full"
                    loading={busy === 'issue'}
                    onClick={() => void act('issue')}
                  >
                    <HandCoins className="h-3.5 w-3.5" /> Issue invoice
                  </Button>
                ) : null}
                {canRecord ? (
                  <Button className="w-full" onClick={() => setReceiptOpen(true)}>
                    <ReceiptIcon className="h-3.5 w-3.5" /> Record receipt
                  </Button>
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
                    <ShieldCheck className="h-3.5 w-3.5" /> Fully collected
                  </p>
                ) : null}
                {!canReceipt && ['ISSUED', 'PARTIALLY_PAID'].includes(data.status) ? (
                  <p className="text-[11px] text-muted">
                    An APPROVER or ADMIN records receipts.
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {customer ? (
            <Card className="p-5">
              <SectionTitle title="Customer" />
              <p className="mt-2 text-[13px] font-medium">{customer.name}</p>
              <p className="text-[11px] text-muted">{customer.email}</p>
            </Card>
          ) : null}

          <Card className="p-5">
            <SectionTitle title="Cash status" />
            <div className="mt-3 space-y-2 text-[12px]">
              <div className="flex justify-between text-muted">
                <span>Total</span>
                <span className="font-num">
                  {formatMoney(data.total, data.decimals, data.currency)}
                </span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Collected</span>
                <span className="font-num text-mint">
                  {formatMoney(data.paidAmount, data.decimals, data.currency)}
                </span>
              </div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold">
                <span>Outstanding</span>
                <span className="font-num">
                  {formatMoney(outstanding.toString(), data.decimals, data.currency)}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {receiptOpen ? (
        <ReceiptModal
          open
          receivable={data}
          onClose={() => setReceiptOpen(false)}
          onRecorded={() => {
            void receivable.reload();
            void ledger.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ReceiptModal({
  open,
  receivable,
  onClose,
  onRecorded,
}: {
  open: boolean;
  receivable: Receivable;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const outstanding = BigInt(receivable.total) - BigInt(receivable.paidAmount);
  const defaultAmount = formatUnits(outstanding, receivable.decimals);
  const [amount, setAmount] = useState(defaultAmount);
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [txHash, setTxHash] = useState('');
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/receivables/${receivable._id}/receipts`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          method,
          reference: reference || undefined,
          txHash: txHash || undefined,
          receivedAt: receivedAt
            ? new Date(`${receivedAt}T00:00:00Z`).toISOString()
            : undefined,
        }),
      });
      onRecorded();
      onClose();
      setReference('');
      setTxHash('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the receipt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record receipt"
      description="Posts cash against accounts receivable in the ledger."
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="r-amount">Amount ({receivable.currency})</Label>
            <Input
              id="r-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="r-date">Received on</Label>
            <Input
              id="r-date"
              type="date"
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="r-method">Method</Label>
            <Select
              id="r-method"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="ONCHAIN">On-chain</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="r-reference">Reference (optional)</Label>
            <Input
              id="r-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="r-tx">Transaction hash (optional)</Label>
          <Input
            id="r-tx"
            value={txHash}
            onChange={(event) => setTxHash(event.target.value)}
          />
        </div>
        {error ? (
          <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!amount} onClick={() => void submit()}>
            Record receipt
          </Button>
        </div>
      </div>
    </Modal>
  );
}
