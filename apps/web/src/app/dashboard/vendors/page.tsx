'use client';

import { useState } from 'react';
import { Building2, Mail, Plus, Wallet } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { shortAddress } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, EmptyState, Input, Label, Modal, Select, Spinner } from '@/components/ui';

interface Vendor {
  _id: string;
  name: string;
  email: string;
  nearAccountId?: string;
  payoutChain: string;
  payoutAddress: string;
  bankName?: string;
  bankAccount?: string;
}

export default function VendorsPage() {
  const vendors = useApi<Vendor[]>('/vendors');
  const [open, setOpen] = useState(false);

  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Who you pay, and where the money lands."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add vendor
          </Button>
        }
      />

      {vendors.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading vendors
        </div>
      ) : (vendors.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title="No vendors yet"
            body="Add a vendor with a payout chain and address. Intents routes the invoice total to exactly that destination."
            action={<Button onClick={() => setOpen(true)}>Add vendor</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(vendors.data ?? []).map((vendor) => (
            <Card key={vendor._id} className="p-5 transition hover:border-line-strong">
              <div className="flex items-start justify-between gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-paper">
                  <Building2 className="h-4 w-4" />
                </div>
                <Badge className="border-line bg-paper capitalize text-muted">
                  {vendor.payoutChain}
                </Badge>
              </div>
              <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{vendor.name}</h3>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <Mail className="h-3 w-3" /> {vendor.email}
              </p>
              <div className="mt-4 rounded-xl bg-paper px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-muted">Payout address</p>
                <p className="font-num mt-1 truncate text-[11px]">
                  {shortAddress(vendor.payoutAddress, 8)}
                </p>
              </div>
              {vendor.nearAccountId ? (
                <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted">
                  <Wallet className="h-3 w-3" /> {vendor.nearAccountId}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <VendorForm
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => void vendors.reload()}
      />
    </div>
  );
}

function VendorForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [payoutChain, setPayoutChain] = useState('near');
  const [payoutAddress, setPayoutAddress] = useState('');
  const [nearAccountId, setNearAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api('/vendors', {
        method: 'POST',
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
      setName('');
      setEmail('');
      setPayoutAddress('');
      setNearAccountId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add vendor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add vendor"
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
              <option value="sol">Solana</option>
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
          <Button loading={busy} disabled={!name || !email || !payoutAddress} onClick={() => void submit()}>
            Add vendor
          </Button>
        </div>
      </div>
    </Modal>
  );
}
