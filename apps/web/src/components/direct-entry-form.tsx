'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from './feedback';
import { Button, Field, Input, Label, Modal, Select } from './ui';

export interface AccountOption {
  _id: string;
  code: string;
  name: string;
  type: string;
  archived?: boolean;
}

export type DirectEntryKind = 'EXPENSE' | 'REVENUE';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const COPY = {
  EXPENSE: {
    title: 'New direct expense',
    description:
      'Records money already paid: the expense is debited and cash is credited. The number is EXP-YY/MM/XXXXX.',
    accountLabel: 'Expense account',
    numberHint: 'EXP-YY/MM/XXXXX · generated on save',
    endpoint: '/accounting/expenses',
    defaultAccount: '5100',
  },
  REVENUE: {
    title: 'New direct revenue',
    description:
      'Records money already received: cash is debited and revenue is credited. The number is REV-YY/MM/XXXX.',
    accountLabel: 'Revenue account',
    numberHint: 'REV-YY/MM/XXXX · generated on save',
    endpoint: '/accounting/revenues',
    defaultAccount: '4000',
  },
} as const;

export function DirectEntryForm({
  open,
  kind,
  accounts,
  onClose,
  onCreated,
}: {
  open: boolean;
  kind: DirectEntryKind;
  accounts: AccountOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const copy = COPY[kind];
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [accountCode, setAccountCode] = useState<string>(copy.defaultAccount);
  const [cashAccountCode, setCashAccountCode] = useState('1010');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const toast = useToast();

  const pnlAccounts = useMemo(
    () => accounts.filter((account) => account.type === kind && !account.archived),
    [accounts, kind],
  );
  const cashAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'ASSET' && !account.archived),
    [accounts],
  );

  useEffect(() => {
    if (!open) return;
    setDate(today());
    setAmount('');
    setCurrency('USD');
    setAccountCode(copy.defaultAccount);
    setCashAccountCode('1010');
    setMemo('');
    setError(null);
    setAttempted(false);
  }, [open, copy.defaultAccount]);

  // Archived or custom charts may not contain 5100/4000/1010. Fall back to the
  // first eligible account once the chart has loaded.
  useEffect(() => {
    if (pnlAccounts.length > 0 && !pnlAccounts.some((account) => account.code === accountCode)) {
      setAccountCode(pnlAccounts[0].code);
    }
  }, [pnlAccounts, accountCode]);

  useEffect(() => {
    if (cashAccounts.length > 0 && !cashAccounts.some((account) => account.code === cashAccountCode)) {
      setCashAccountCode(cashAccounts[0].code);
    }
  }, [cashAccounts, cashAccountCode]);

  const amountValid = Number(amount) > 0;

  async function submit() {
    setAttempted(true);
    setError(null);
    if (!amountValid || !accountCode || !cashAccountCode || !memo.trim()) {
      setError('Check the highlighted fields before posting.');
      return;
    }
    setBusy(true);
    try {
      await api(copy.endpoint, {
        method: 'POST',
        body: JSON.stringify({
          date: new Date(`${date}T00:00:00Z`).toISOString(),
          amount,
          currency,
          accountCode,
          cashAccountCode,
          memo: memo.trim(),
        }),
      });
      onCreated();
      onClose();
      toast(kind === 'EXPENSE' ? 'Expense posted' : 'Revenue posted');
      setAmount('');
      setMemo('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the entry');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={copy.title} description={copy.description} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="de-number">Document number</Label>
            <div
              id="de-number"
              className="mt-1 flex h-10 items-center rounded-control border border-line bg-ink/[0.02] px-3 font-num text-small text-muted"
            >
              {copy.numberHint}
            </div>
          </div>
          <div>
            <Label htmlFor="de-date">Date</Label>
            <Input
              id="de-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="de-amount">Amount</Label>
            <Input
              id="de-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              aria-invalid={attempted && !amountValid}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="de-currency">Currency</Label>
            <Select
              id="de-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="SGD">SGD</option>
              <option value="IDR">IDR</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="de-account">{copy.accountLabel}</Label>
            <Select
              id="de-account"
              value={accountCode}
              onChange={(event) => setAccountCode(event.target.value)}
            >
              {pnlAccounts.length === 0 ? <option value="">No matching accounts</option> : null}
              {pnlAccounts.map((account) => (
                <option key={account.code} value={account.code}>
                  {account.code} · {account.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="de-cash">Cash / bank account</Label>
            <Select
              id="de-cash"
              value={cashAccountCode}
              onChange={(event) => setCashAccountCode(event.target.value)}
            >
              {cashAccounts.map((account) => (
                <option key={account.code} value={account.code}>
                  {account.code} · {account.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Field id="de-memo" label="Memo" error={attempted && !memo.trim() ? 'Add a memo.' : null}>
          <Input
            id="de-memo"
            placeholder={kind === 'EXPENSE' ? 'Office rent, contractor payment, …' : 'Consulting fee, product sale, …'}
            value={memo}
            aria-invalid={attempted && !memo.trim()}
            onChange={(event) => setMemo(event.target.value)}
          />
        </Field>

        {error ? (
          <p className="rounded-control bg-rose-soft px-3 py-2 text-small text-rose" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {kind === 'EXPENSE' ? 'Post expense' : 'Post revenue'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
