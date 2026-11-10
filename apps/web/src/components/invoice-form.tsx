'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from './feedback';
import { Button, Input, Label, Modal, Select, Textarea } from './ui';

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
  const [issueDate, setIssueDate] = useState(
    invoice ? invoice.issueDate.slice(0, 10) : today(),
  );
  const [dueDate, setDueDate] = useState(
    invoice ? invoice.dueDate.slice(0, 10) : inDays(14),
  );
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
  }, [open, invoice]);

  const preview = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => {
      const qty = Number(line.quantity || 0);
      const price = Number(line.unitPrice || 0);
      return sum + qty * price;
    }, 0);
    const tax = subtotal * (Number(taxBps || 0) / 10_000);
    return { subtotal, tax, total: subtotal + tax };
  }, [lines, taxBps]);

  const canSubmit =
    Boolean(vendorId) &&
    Boolean(number.trim()) &&
    lines.length > 0 &&
    lines.every(
      (line) =>
        line.description.trim().length > 0 &&
        Number(line.quantity) > 0 &&
        Number(line.unitPrice) > 0,
    );

  function updateLine(index: number, patch: Partial<LineItem>) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (!vendorId) throw new Error('Select a vendor');
      if (lines.some((line) => !line.description || !line.unitPrice)) {
        throw new Error('Every line needs a description and unit price');
      }
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the bill');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit vendor bill' : 'New vendor bill'}
      description="Totals are computed in integer minor units on the server."
      wide
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="vendor">Vendor</Label>
            <Select id="vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Select a vendor…</option>
              {vendors.map((vendor) => (
                <option key={vendor._id} value={vendor._id}>
                  {vendor.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="number">Invoice number</Label>
            <Input id="number" value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
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
              onChange={(e) =>
                setTaxBps(String(Math.round(Number(e.target.value || 0) * 100)))
              }
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Line items</Label>
            <button
              type="button"
              onClick={() => setLines((current) => [...current, emptyLine()])}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
            >
              <Plus className="h-3 w-3" /> Add line
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_1fr_40px] items-center gap-2 rounded-control border border-line p-2 sm:grid-cols-[1fr_64px_96px_28px] sm:rounded-none sm:border-0 sm:p-0"
              >
                <Input
                  className="col-span-3 sm:col-span-1"
                  placeholder="Description"
                  aria-label={`Line ${index + 1} description`}
                  value={line.description}
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                />
                <Input
                  placeholder="Qty"
                  aria-label={`Line ${index + 1} quantity`}
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                />
                <Input
                  placeholder="Unit price"
                  aria-label={`Line ${index + 1} unit price`}
                  value={line.unitPrice}
                  onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  className="justify-self-center rounded-lg p-2 text-muted transition hover:bg-rose-soft hover:text-rose disabled:opacity-40"
                  aria-label={`Remove line ${index + 1}`}
                  disabled={lines.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
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

        <div className="rounded-xl bg-paper px-4 py-3">
          <div className="flex items-center justify-between text-[13px] text-muted">
            <span>Subtotal</span>
            <span className="font-num">{preview.subtotal.toFixed(2)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[13px] text-muted">
            <span>Tax</span>
            <span className="font-num">{preview.tax.toFixed(2)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-sm font-semibold">
            <span>Total</span>
            <span className="font-num">
              {currency} {preview.total.toFixed(2)}
            </span>
          </div>
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
          <Button loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            {isEdit ? 'Save changes' : 'Create bill'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
