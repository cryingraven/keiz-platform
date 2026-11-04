'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CURRENCY_DECIMALS, parseUnits } from '@keiz/shared';
import { api } from '@/lib/api';
import { Button, Input, Label, Modal, Select } from './ui';

export interface Account {
  _id: string;
  code: string;
  name: string;
  type: string;
}

interface Line {
  accountCode: string;
  debit: string;
  credit: string;
}

const emptyLine = (): Line => ({ accountCode: '', debit: '', credit: '' });

export function ManualJournalForm({
  open,
  accounts,
  onClose,
  onCreated,
}: {
  open: boolean;
  accounts: Account[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [memo, setMemo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('USD');
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decimals = CURRENCY_DECIMALS[currency] ?? 2;

  const totals = useMemo(() => {
    let debit = 0n;
    let credit = 0n;
    for (const line of lines) {
      try {
        if (line.debit) debit += parseUnits(line.debit, decimals);
      } catch {
        // Invalid input is reported on submit; the running total ignores it.
      }
      try {
        if (line.credit) credit += parseUnits(line.credit, decimals);
      } catch {
        // Same as above.
      }
    }
    return { debit, credit, balanced: debit === credit && debit > 0n };
  }, [lines, decimals]);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (!memo.trim()) throw new Error('Add a memo');
      if (lines.some((line) => !line.accountCode)) throw new Error('Pick an account on every line');
      if (!totals.balanced) throw new Error('Debits and credits must balance');
      await api('/accounting/journal-entries', {
        method: 'POST',
        body: JSON.stringify({
          memo,
          currency,
          date: date ? new Date(`${date}T00:00:00Z`).toISOString() : undefined,
          lines: lines.map((line) => ({
            accountCode: line.accountCode,
            debit: line.debit || '0',
            credit: line.credit || '0',
          })),
        }),
      });
      onCreated();
      onClose();
      setMemo('');
      setLines([emptyLine(), emptyLine()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the entry');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New journal entry"
      description="Manual entries are immutable. In every line, fill exactly one side."
      wide
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label htmlFor="j-memo">Memo</Label>
            <Input
              id="j-memo"
              placeholder="Opening balances, adjustment, …"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="j-date">Date</Label>
            <Input
              id="j-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="j-currency">Currency</Label>
            <Select
              id="j-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="SGD">SGD</option>
              <option value="IDR">IDR</option>
            </Select>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Lines</Label>
            <button
              type="button"
              onClick={() => setLines((current) => [...current, emptyLine()])}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
            >
              <Plus className="h-3 w-3" /> Add line
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_100px_100px_28px] items-center gap-2"
              >
                <Select
                  value={line.accountCode}
                  onChange={(event) =>
                    updateLine(index, { accountCode: event.target.value })
                  }
                >
                  <option value="">Select account…</option>
                  {accounts.map((account) => (
                    <option key={account._id} value={account.code}>
                      {account.code} · {account.name}
                    </option>
                  ))}
                </Select>
                <Input
                  placeholder="Debit"
                  inputMode="decimal"
                  value={line.debit}
                  onChange={(event) =>
                    updateLine(index, { debit: event.target.value, credit: '' })
                  }
                />
                <Input
                  placeholder="Credit"
                  inputMode="decimal"
                  value={line.credit}
                  onChange={(event) =>
                    updateLine(index, { credit: event.target.value, debit: '' })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setLines((current) => current.filter((_, i) => i !== index))
                  }
                  className="rounded-lg p-1.5 text-muted transition hover:bg-rose-soft hover:text-rose"
                  aria-label="Remove line"
                  disabled={lines.length <= 2}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div
          className={
            totals.balanced
              ? 'rounded-xl border border-mint/20 bg-mint-soft px-4 py-3 text-[12px] text-mint'
              : 'rounded-xl border border-amber/20 bg-amber-soft px-4 py-3 text-[12px] text-amber'
          }
        >
          <div className="flex items-center justify-between">
            <span>Total debits</span>
            <span className="font-num">{totals.debit.toString()}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>Total credits</span>
            <span className="font-num">{totals.credit.toString()}</span>
          </div>
          <div className="mt-1 border-t border-current/10 pt-1 font-medium">
            {totals.balanced ? 'Balanced' : 'Entry must balance before posting'}
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
          <Button loading={busy} disabled={!totals.balanced} onClick={() => void submit()}>
            Post entry
          </Button>
        </div>
      </div>
    </Modal>
  );
}
