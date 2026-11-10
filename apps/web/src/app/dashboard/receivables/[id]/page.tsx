'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Check,
  ChevronRight,
  CircleSlash,
  Copy,
  Download,
  HandCoins,
  Plus,
  Receipt as ReceiptIcon,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { formatUnits } from '@keiz/shared';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { downloadApiFile } from '@/lib/download';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { useConfirm, useToast } from '@/components/feedback';
import { ShareDocumentDialog } from '@/components/documents/share-dialog';
import {
  Button,
  Card,
  Input,
  Label,
  Modal,
  ProgressSteps,
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

interface TokenInfo {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
}

export default function ReceivableDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const receivable = useApi<Receivable>(id ? `/receivables/${id}` : null);
  const customers = useApi<Customer[]>('/customers');
  const ledger = useApi<{ items: JournalEntry[] }>(
    id ? `/accounting/journal-entries?sourceType=receivable&sourceId=${id}&pageSize=100` : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const { session } = useAuth();
  const role = session?.role ?? 'MEMBER';
  const canReceipt = ['APPROVER', 'ADMIN', 'OWNER'].includes(role);
  const canAdmin = ['ADMIN', 'OWNER'].includes(role);

  const customer = customers.data?.find((item) => item._id === receivable.data?.customerId);

  async function downloadPdf() {
    setDownloading(true);
    try {
      await downloadApiFile(`/documents/invoice/${id}/pdf`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not download the PDF', 'error');
    } finally {
      setDownloading(false);
    }
  }

  async function act(action: 'issue' | 'void') {
    if (!receivable.data) return;
    if (action === 'void') {
      const ok = await confirm({
        title: 'Void this customer invoice?',
        body: `Invoice ${receivable.data.number} will be voided and its receivable reversed in the ledger.`,
        confirmLabel: 'Void invoice',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusy(action);
    setError(null);
    try {
      await api(`/receivables/${id}/${action}`, { method: 'POST' });
      await receivable.reload();
      await ledger.reload();
      toast(action === 'issue' ? 'Invoice issued' : 'Invoice voided', action === 'void' ? 'info' : 'success');
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
  const canShare =
    canReceipt && ['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(data.status);
  const stepIndex =
    data.status === 'PAID'
      ? 3
      : data.status === 'PARTIALLY_PAID'
        ? 2
        : data.status === 'ISSUED'
          ? 1
          : 0;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12px] text-muted">
          <Link href="/dashboard" className="transition hover:text-ink">
            Workspace
          </Link>
          <ChevronRight className="h-3 w-3" />
          <Link href="/dashboard/receivables" className="transition hover:text-ink">
            Receivables
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="font-num font-medium text-ink">{data.number}</span>
        </nav>
        <div className="flex items-center gap-2">
          {canShare ? (
            <Button variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
              <Share2 className="h-3.5 w-3.5" /> Share
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            loading={downloading}
            onClick={() => void downloadPdf()}
          >
            {downloading ? null : <Download className="h-3.5 w-3.5" />} Download PDF
          </Button>
        </div>
      </div>

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
          <p className="text-[11px] uppercase tracking-wider text-muted">Outstanding</p>
          <p className="font-num text-2xl font-semibold">
            {formatMoney(outstanding.toString(), data.decimals, data.currency)}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            of {formatMoney(data.total, data.decimals, data.currency)}
          </p>
        </div>
      </div>

      <Card className="mb-4 overflow-x-auto px-4 py-3 scroll-thin">
        <ProgressSteps
          labels={['Draft', 'Issued', 'Partially paid', 'Paid']}
          current={stepIndex}
        />
      </Card>

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
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-5 py-2.5 font-medium">Description</th>
                  <th className="px-5 py-2.5 text-right font-medium">Qty</th>
                  <th className="px-5 py-2.5 text-right font-medium">Unit</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.lineItems.map((line, index) => (
                  <tr key={index}>
                    <td className="px-5 py-3 text-[14px]">{line.description}</td>
                    <td className="font-num px-5 py-3 text-right text-[13px] text-muted">
                      {line.quantity}
                    </td>
                    <td className="font-num px-5 py-3 text-right text-[13px] text-muted">
                      {line.unitPrice}
                    </td>
                    <td className="font-num px-5 py-3 text-right text-[14px]">
                      {formatMoney(line.lineTotal, data.decimals, data.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="space-y-1.5 border-t border-line px-5 py-4 text-[13px]">
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
              <div className="flex justify-between border-t border-line pt-2 text-[14px] font-semibold">
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
              <p className="px-5 py-6 text-[13px] text-muted">
                No cash received yet. Issue the invoice first, then record receipts.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-5 py-2.5 font-medium">Received</th>
                    <th className="px-5 py-2.5 font-medium">Method</th>
                    <th className="px-5 py-2.5 font-medium">Reference</th>
                    <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.receipts.map((receipt) => (
                    <tr key={receipt.receiptId}>
                      <td className="px-5 py-3 text-[13px] text-muted">
                        {formatDate(receipt.receivedAt)}
                      </td>
                      <td className="px-5 py-3 text-[13px]">{humanize(receipt.method)}</td>
                      <td className="font-num px-5 py-3 text-[12px] text-muted">
                        {receipt.reference ?? receipt.txHash ?? '—'}
                      </td>
                      <td className="font-num px-5 py-3 text-right text-[14px]">
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
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-muted">
                {data.notes}
              </p>
            </Card>
          ) : null}

          <Card className="p-5">
            <SectionTitle title="Ledger postings" hint="Issue and reversal entries" />
            {ledger.loading ? (
              <div className="mt-3 flex items-center gap-2 text-[13px] text-muted">
                <Spinner /> Loading postings
              </div>
            ) : (ledger.data?.items.length ?? 0) === 0 ? (
              <p className="mt-3 text-[13px] text-muted">
                Nothing posted yet. Issuing the invoice creates the AR entry.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {ledger.data?.items.map((entry) => (
                  <div key={entry._id} className="rounded-xl border border-line px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium">{entry.memo}</p>
                      <span className="text-[11px] uppercase tracking-wider text-muted">
                        {humanize(entry.event)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">{formatDate(entry.date)}</p>
                    <div className="mt-2 space-y-1">
                      {entry.lines.map((line, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between text-[12px]"
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
                {['ISSUED', 'PARTIALLY_PAID'].includes(data.status) ? (
                  <Button
                    className="w-full"
                    variant="secondary"
                    onClick={() => setCollectOpen(true)}
                  >
                    <HandCoins className="h-3.5 w-3.5" /> Collect on-chain
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
                  <p className="flex items-center gap-1.5 text-[13px] text-mint">
                    <ShieldCheck className="h-3.5 w-3.5" /> Fully collected
                  </p>
                ) : null}
                {!canReceipt && ['ISSUED', 'PARTIALLY_PAID'].includes(data.status) ? (
                  <p className="text-[12px] text-muted">
                    An APPROVER or ADMIN records receipts.
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {customer ? (
            <Card className="p-5">
              <SectionTitle title="Customer" />
              <p className="mt-2 text-[14px] font-medium">{customer.name}</p>
              <p className="text-[12px] text-muted">{customer.email}</p>
            </Card>
          ) : null}

          <Card className="p-5">
            <SectionTitle title="Cash status" />
            <div className="mt-3 space-y-2 text-[13px]">
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

      {collectOpen ? (
        <CollectionModal
          open
          receivableId={data._id}
          number={data.number}
          onClose={() => setCollectOpen(false)}
          onQuote={() => {
            void receivable.reload();
            void ledger.reload();
          }}
        />
      ) : null}

      <ShareDocumentDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        documentType="invoice"
        documentId={data._id}
        documentNumber={data.number}
      />
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

interface CollectionQuote {
  depositAddress?: string;
  depositMemo?: string;
  amountInFormatted?: string;
  deadline?: string;
  receivableNumber: string;
}

function CollectionModal({
  open,
  receivableId,
  number,
  onClose,
}: {
  open: boolean;
  receivableId: string;
  number: string;
  onClose: () => void;
  onQuote?: () => void;
}) {
  const tokens = useApi<TokenInfo[]>(open ? '/payments/tokens' : null);
  const [originAsset, setOriginAsset] = useState('');
  const [refundTo, setRefundTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<CollectionQuote | null>(null);
  const [copied, setCopied] = useState(false);

  async function createQuote() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<CollectionQuote>(
        `/receivables/${receivableId}/collection-quote`,
        {
          method: 'POST',
          body: JSON.stringify({ originAsset, refundTo }),
        },
      );
      if (!result.depositAddress) {
        throw new Error('1Click did not return a deposit address');
      }
      setQuote(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the collection quote');
    } finally {
      setBusy(false);
    }
  }

  async function copyAddress() {
    if (!quote?.depositAddress) return;
    await navigator.clipboard.writeText(quote.depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Collect ${number} on-chain`}
      description="A customer pays from another chain; 1Click delivers the allowlisted token to the workspace collect contract."
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="c-origin">Customer pays with</Label>
          <Select
            id="c-origin"
            value={originAsset}
            onChange={(event) => setOriginAsset(event.target.value)}
          >
            <option value="">Select an origin token…</option>
            {(tokens.data ?? []).map((token) => (
              <option key={token.assetId} value={token.assetId}>
                {token.symbol} · {token.blockchain}
              </option>
            ))}
          </Select>
          {tokens.loading ? (
            <p className="mt-1 text-[11px] text-muted">Loading 1Click tokens…</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="c-refund">Refund address on the origin chain</Label>
          <Input
            id="c-refund"
            placeholder="0x… or Solana address"
            value={refundTo}
            onChange={(event) => setRefundTo(event.target.value)}
          />
        </div>
        {quote ? (
          <div className="space-y-2 rounded-xl border border-line bg-paper px-3 py-3">
            <p className="text-[12px] font-medium">Send exactly</p>
            <p className="font-num text-[14px]">
              {quote.amountInFormatted} {quote.depositMemo ? `· memo ${quote.depositMemo}` : ''}
            </p>
            <div className="flex items-center gap-2">
              <code className="font-num min-w-0 flex-1 truncate rounded-lg bg-surface px-2 py-1.5 text-[12px]">
                {quote.depositAddress}
              </code>
              <button
                type="button"
                onClick={() => void copyAddress()}
                className="rounded-lg p-1.5 text-muted transition hover:bg-surface hover:text-ink"
                aria-label="Copy deposit address"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-mint" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-muted">
              Deposit before {quote.deadline ? new Date(quote.deadline).toLocaleString('en-US') : 'the quote expires'}.
              The receipt is recorded automatically after delivery.
            </p>
          </div>
        ) : null}
        {error ? (
          <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            loading={busy}
            disabled={!originAsset || !refundTo}
            onClick={() => void createQuote()}
          >
            {quote ? 'Create another quote' : 'Create collection quote'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
