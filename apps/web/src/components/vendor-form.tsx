'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from './feedback';
import { Button, Input, Label, Modal, Select } from './ui';

export interface VendorFormValue {
  _id: string;
  name: string;
  email: string;
  nearAccountId?: string;
  payoutChain: string;
  payoutAddress: string;
}

/**
 * Shared create/edit vendor dialog used by the Vendors page and the Bills page.
 */
export function VendorForm({
  open,
  vendor,
  onClose,
  onCreated,
}: {
  open: boolean;
  vendor?: VendorFormValue | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isEdit = Boolean(vendor);
  const [name, setName] = useState(vendor?.name ?? '');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [payoutChain, setPayoutChain] = useState(vendor?.payoutChain ?? 'near');
  const [payoutAddress, setPayoutAddress] = useState(vendor?.payoutAddress ?? '');
  const [nearAccountId, setNearAccountId] = useState(vendor?.nearAccountId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(isEdit ? `/vendors/${vendor!._id}` : '/vendors', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name,
          email,
          payoutChain,
          payoutAddress,
          nearAccountId: nearAccountId || undefined,
        }),
      });
      onCreated();
      onClose();
      toast(isEdit ? 'Vendor updated' : 'Vendor added');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the vendor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit vendor' : 'Add vendor'}
      description="The payout address is where 1Click delivers the invoice amount."
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="v-name">Name</Label>
          <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="v-email">Email</Label>
          <Input
            id="v-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="v-chain">Payout chain</Label>
            <Select
              id="v-chain"
              value={payoutChain}
              onChange={(e) => setPayoutChain(e.target.value)}
            >
              <option value="near">NEAR</option>
              <option value="eth">Ethereum</option>
              <option value="base">Base</option>
              <option value="arb">Arbitrum</option>
              <option value="bsc">BNB Chain</option>
              <option value="polygon">Polygon</option>
              <option value="sol">Solana</option>
              <option value="stellar">Stellar</option>
              <option value="tron">Tron</option>
              <option value="ton">TON</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="v-near">NEAR account (optional)</Label>
            <Input
              id="v-near"
              placeholder="vendor.near"
              value={nearAccountId}
              onChange={(e) => setNearAccountId(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="v-address">Payout address</Label>
          <Input
            id="v-address"
            placeholder="vendor.near or 0x…"
            value={payoutAddress}
            onChange={(e) => setPayoutAddress(e.target.value)}
          />
        </div>
        {error ? (
          <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!name || !email || !payoutAddress}
            onClick={() => void submit()}
          >
            {isEdit ? 'Save changes' : 'Add vendor'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
