'use client';

import { useState } from 'react';
import { Archive, Building2, Mail, Pencil, Plus, Wallet } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { shortAddress } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { useConfirm, useToast } from '@/components/feedback';
import { VendorForm } from '@/components/vendor-form';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
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
  const confirm = useConfirm();
  const toast = useToast();

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(vendor: Vendor) {
    setEditing(vendor);
    setOpen(true);
  }

  async function archive(vendor: Vendor) {
    const ok = await confirm({
      title: `Archive ${vendor.name}?`,
      body: 'Existing bills keep their history. You can add the vendor again later.',
      confirmLabel: 'Archive vendor',
      tone: 'danger',
    });
    if (!ok) return;
    setError(null);
    try {
      await api(`/vendors/${vendor._id}`, { method: 'DELETE' });
      await vendors.reload();
      toast('Vendor archived');
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
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                <Mail className="h-3 w-3" /> {vendor.email}
              </p>
              <div className="mt-4 rounded-xl bg-paper px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wider text-muted">Payout address</p>
                <p className="font-num mt-1 truncate text-[12px]">
                  {shortAddress(vendor.payoutAddress, 8)}
                </p>
              </div>
              {vendor.nearAccountId ? (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
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
