'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from './feedback';
import { Alert, Button, Field, Input, Label, Modal, Select, Textarea } from './ui';

interface Vendor {
  _id: string;
  name: string;
}

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface EditableInvoice {
  _id: string;
  vendorId: string;
  number: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  taxBps: number;
  notes?: string;
  lineItems: Array<{ description: string; quantity: string; unitPrice: string }>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const emptyLine = (): LineItem => ({ description: '', quantity: '1', unitPrice: '' });

export function InvoiceForm({
  open,
  vendors,
  invoice,
  onClose,
  onCreated,
}: {
  open: boolean;
  vendors: Vendor[];
  invoice?: EditableInvoice | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isEdit = Boolean(invoice);
  const [vendorId, setVendorId] = useState(invoice?.vendorId ?? '');
  const [number, setNumber] = useState(
    invoice?.number ?? `INV-${Math.floor(1000 + Math.random() * 9000)}`,
  );
  const [issueDate, setIssueDate] = useState(invoice ? invoice.issueDate.slice(0, 10) : today());
  const [dueDate, setDueDate] = useState(invoice ? invoice.dueDate.slice(0, 10) : inDays(14));
  const [currency, setCurrency] = useState(invoice?.currency ?? 'USD');
  const [taxBps, setTaxBps] = useState(String(invoice?.taxBps ?? 0));
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [lines, setLines] = useState<LineItem[]>(
    invoice?.lineItems?.length
      ? invoice.lineItems.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        }))
      : [emptyLine()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setVendorId(invoice?.vendorId ?? '');
    setNumber(invoice?.number ?? `INV-${Math.floor(1000 + Math.random() * 9000)}`);
    setIssueDate(invoice ? invoice.issueDate.slice(0, 10) : today());
    setDueDate(invoice ? invoice.dueDate.slice(0, 10) : inDays(14));
    setCurrency(invoice?.currency ?? 'USD');
    setTaxBps(String(invoice?.taxBps ?? 0));
    setNotes(invoice?.notes ?? '');
    setLines(
      invoice?.lineItems?.length
        ? invoice.lineItems.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          }))
        : [emptyLine()],
    );
    setError(null);
    setAttempted(false);
  }, [open, invoice]);

  const lineErrors = useMemo(
    () =>
      lines.map((line) => ({
        description: !line.description.trim(),
        quantity: !(Number(line.quantity) > 0),
        unitPrice: !(Number(line.unitPrice) > 0),
      })),
    [lines],
  );
  const invalid = lineErrors.some((line) => line.description || line.quantity || line.unitPrice);

  const preview = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => {
      const qty = Number(line.quantity || 0);
      const price = Number(line.unitPrice || 0);
      return sum + qty * price;
    }, 0);
    const tax = subtotal * (Number(taxBps || 0) / 10_000);
    return { subtotal, tax, total: subtotal + tax };
  }, [lines, taxBps]);

  function updateLine(index: number, patch: Partial<LineItem>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit() {
    setAttempted(true);
    setError(null);
    if (!vendorId || !number.trim() || invalid) {
      setError('Check the highlighted fields before saving.');
      return;
    }
    setBusy(true);
    try {
      await api(isEdit ? `/invoices/${invoice!._id}` : '/invoices', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({
          vendorId,
          number,
          issueDate: new Date(`${issueDate}T00:00:00Z`).toISOString(),
          dueDate: new Date(`${dueDate}T00:00:00Z`).toISOString(),
          currency,
          taxBps: Number(taxBps || 0),
          notes: notes || undefined,
          lineItems: lines,
        }),
      });
      onCreated();
      onClose();
      toast(isEdit ? 'Bill updated' : 'Bill created');
      if (!isEdit) {
        setLines([emptyLine()]);
        setNotes('');
        setNumber(`INV-${Math.floor(1000 + Math.random() * 9000)}`);
        setAttempted(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the bill');
    } finally {
      setBusy(false);
    }
  }

  const money = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit vendor bill' : 'New vendor bill'}
      description="Add the vendor, dates and line items. You can submit it for approval after saving."
      wide
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="vendor"
            label="Vendor"
            error={attempted && !vendorId ? 'Choose a vendor.' : null}
          >
            <Select
              id="vendor"
              value={vendorId}
              aria-invalid={attempted && !vendorId}
              aria-describedby={attempted && !vendorId ? 'vendor-error' : undefined}
              onChange={(e) => setVendorId(e.target.value)}
            >
              <option value="">Select a vendor…</option>
              {vendors.map((vendor) => (
                <option key={vendor._id} value={vendor._id}>
                  {vendor.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="number"
            label="Invoice number"
            error={attempted && !number.trim() ? 'Enter the bill number.' : null}
          >
            <Input
              id="number"
              value={number}
              aria-invalid={attempted && !number.trim()}
              aria-describedby={attempted && !number.trim() ? 'number-error' : undefined}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
          <div>
            <Label htmlFor="issue">Issue date</Label>
            <Input
              id="issue"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="due">Due date</Label>
            <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="currency">Currency</Label>
            <Select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="SGD">SGD</option>
              <option value="IDR">IDR</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="tax">Tax (%)</Label>
            <Input
              id="tax"
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={(Number(taxBps || 0) / 100).toString()}
              onChange={(e) => setTaxBps(String(Math.round(Number(e.target.value || 0) * 100)))}
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-small font-medium">Line items</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setLines((current) => [...current, emptyLine()])}
            >
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => {
              const lineError = lineErrors[index];
              const showDescription = attempted && lineError.description;
              const showQuantity = attempted && lineError.quantity;
              const showPrice = attempted && lineError.unitPrice;
              return (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] gap-2 rounded-control border border-line p-3 sm:grid-cols-[minmax(0,1fr)_80px_120px_32px] sm:items-start sm:border-0 sm:p-0"
                >
                  <div className="col-span-3 sm:col-span-1">
                    <Input
                      placeholder="Description"
                      aria-label={`Line ${index + 1} description`}
                      aria-invalid={showDescription}
                      className={showDescription ? 'border-rose/60' : undefined}
                      value={line.description}
                      onChange={(e) => updateLine(index, { description: e.target.value })}
                    />
                    {showDescription ? (
                      <p className="mt-1 text-meta text-rose">Add a description.</p>
                    ) : null}
                  </div>
                  <div>
                    <Input
                      placeholder="Qty"
                      inputMode="decimal"
                      aria-label={`Line ${index + 1} quantity`}
                      aria-invalid={showQuantity}
                      className={showQuantity ? 'border-rose/60' : undefined}
                      value={line.quantity}
                      onChange={(e) => updateLine(index, { quantity: e.target.value })}
                    />
                    {showQuantity ? <p className="mt-1 text-meta text-rose">Qty &gt; 0.</p> : null}
                  </div>
                  <div>
                    <Input
                      placeholder="Unit price"
                      inputMode="decimal"
                      aria-label={`Line ${index + 1} unit price`}
                      aria-invalid={showPrice}
                      className={showPrice ? 'border-rose/60' : undefined}
                      value={line.unitPrice}
                      onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                    />
                    {showPrice ? <p className="mt-1 text-meta text-rose">Price &gt; 0.</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    className="justify-self-end rounded-control p-2 text-muted transition hover:bg-rose-soft hover:text-rose disabled:opacity-40 sm:justify-self-center"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={lines.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            placeholder="Optional context for the approver"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <dl className="rounded-control bg-surface-raised px-4 py-3 text-small">
          <div className="flex items-center justify-between text-muted">
            <dt>Subtotal</dt>
            <dd className="font-num">{money(preview.subtotal)}</dd>
          </div>
          <div className="mt-1 flex items-center justify-between text-muted">
            <dt>Tax</dt>
            <dd className="font-num">{money(preview.tax)}</dd>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-ui font-medium">
            <dt>Total</dt>
            <dd className="font-num">{money(preview.total)}</dd>
          </div>
        </dl>

        {error ? (
          <Alert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {isEdit ? 'Save changes' : 'Create bill'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
