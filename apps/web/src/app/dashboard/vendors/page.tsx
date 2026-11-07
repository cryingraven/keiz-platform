'use client';

import { useState } from 'react';
import { Archive, Building2, Mail, Pencil, Plus, Wallet } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { shortAddress } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Modal,
  Select,
  Spinner,
} from '@/components/ui';

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
  const { session } = useAuth();
  const canAdmin = ['ADMIN', 'OWNER'].includes(session?.role ?? '');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(vendor: Vendor) {
    setEditing(vendor);
    setOpen(true);
  }

  async function archive(vendor: Vendor) {
    if (!window.confirm(`Archive ${vendor.name}? Existing bills keep their history.`)) return;
    setError(null);
    try {
      await api(`/vendors/${vendor._id}`, { method: 'DELETE' });
      await vendors.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive the vendor');
    }
  }

  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Who you pay, and where the money lands."
        actions={
          canAdmin ? (
            <Button onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> Add vendor
            </Button>
          ) : null
        }
      />

      {error ? (
        <p className="mb-4 rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
          {error}
        </p>
      ) : null}

      {vendors.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading vendors
        </div>
      ) : vendors.error ? (
        <Card>
          <ErrorState message={vendors.error} onRetry={() => void vendors.reload()} />
        </Card>
      ) : (vendors.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title="No vendors yet"
            body="Add a vendor with a payout chain and address. Intents routes the invoice total to exactly that destination."
            action={
              canAdmin ? <Button onClick={openCreate}>Add vendor</Button> : undefined
            }
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
                <div className="flex items-center gap-1">
                  <Badge className="border-line bg-paper capitalize text-muted">
                    {vendor.payoutChain}
                  </Badge>
                  {canAdmin ? (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(vendor)}
                        className="rounded-lg p-1.5 text-muted transition hover:bg-paper hover:text-ink"
                        aria-label={`Edit ${vendor.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void archive(vendor)}
                        className="rounded-lg p-1.5 text-muted transition hover:bg-rose-soft hover:text-rose"
                        aria-label={`Archive ${vendor.name}`}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : null}
                </div>
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
        key={editing?._id ?? 'new'}
        open={open}
        vendor={editing}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        onCreated={() => void vendors.reload()}
      />
    </div>
  );
}

function VendorForm({
  open,
  vendor,
  onClose,
  onCreated,
}: {
  open: boolean;
  vendor?: Vendor | null;
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
          <Button loading={busy} disabled={!name || !email || !payoutAddress} onClick={() => void submit()}>
            {isEdit ? 'Save changes' : 'Add vendor'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
