'use client';

import { useEffect, useState } from 'react';
import { Cable, Settings } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, Input, Label, Select, Spinner } from '@/components/ui';

interface Collection {
  contractId: string;
  network: 'mainnet' | 'testnet';
  treasury: string;
  assetId: string;
  tokenContract: string;
  decimals: number;
  status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'DISABLED';
  validatedAt?: string;
}

export default function SettingsPage() {
  const collection = useApi<Collection | null>('/orgs/current/collection');
  const { session } = useAuth();
  const canEdit = ['ADMIN', 'OWNER'].includes(session?.role ?? '');
  const [form, setForm] = useState<Collection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(collection.data ?? null);
  }, [collection.data]);

  function update<K extends keyof Collection>(key: K, value: Collection[K]) {
    setForm((current) =>
      current
        ? { ...current, [key]: value }
        : ({
            contractId: '',
            network: 'testnet',
            treasury: '',
            assetId: '',
            tokenContract: '',
            decimals: 6,
            status: 'ACTIVE',
            [key]: value,
          } as Collection),
    );
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await api('/orgs/current/collection', {
        method: 'PATCH',
        body: JSON.stringify({
          contractId: form.contractId,
          treasury: form.treasury,
          assetId: form.assetId,
          tokenContract: form.tokenContract,
          decimals: Number(form.decimals),
          status: form.status,
        }),
      });
      await collection.reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not validate the collection contract');
    } finally {
      setBusy(false);
    }
  }

  const value = form ?? {
    contractId: '',
    network: collection.data?.network ?? 'testnet',
    treasury: '',
    assetId: '',
    tokenContract: '',
    decimals: 6,
    status: 'ACTIVE' as const,
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Workspace-level on-chain collection configuration."
      />

      <Card className="max-w-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Cable className="h-4 w-4 text-brand" /> AR collection contract
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              Each workspace uses its own <span className="font-num">keiz-collect</span> contract.
              The API validates the contract&apos;s org id, treasury, token allowlist and code hash
              before saving it.
            </p>
            <p className="mt-1 font-num text-[10px] text-muted">
              Workspace id: {session?.org?.id ?? '—'}
            </p>
          </div>
          {collection.data ? <Badge>{collection.data.status}</Badge> : null}
        </div>

        {collection.loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading configuration
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <div>
              <Label htmlFor="c-contract">Contract account</Label>
              <Input
                id="c-contract"
                placeholder="keiz-collect.testnet"
                value={value.contractId}
                disabled={!canEdit}
                onChange={(event) => update('contractId', event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="c-treasury">Treasury account</Label>
              <Input
                id="c-treasury"
                placeholder="treasury.testnet"
                value={value.treasury}
                disabled={!canEdit}
                onChange={(event) => update('treasury', event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="c-token">NEP-141 token contract</Label>
                <Input
                  id="c-token"
                  placeholder="usdc.testnet"
                  value={value.tokenContract}
                  disabled={!canEdit}
                  onChange={(event) => update('tokenContract', event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="c-decimals">Token decimals</Label>
                <Input
                  id="c-decimals"
                  type="number"
                  min={0}
                  max={18}
                  value={value.decimals}
                  disabled={!canEdit}
                  onChange={(event) => update('decimals', Number(event.target.value))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="c-asset">1Click asset id</Label>
              <Input
                id="c-asset"
                placeholder="nep141:usdc.testnet"
                value={value.assetId}
                disabled={!canEdit}
                onChange={(event) => update('assetId', event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="c-status">Status</Label>
              <Select
                id="c-status"
                value={value.status}
                disabled={!canEdit}
                onChange={(event) => update('status', event.target.value as Collection['status'])}
              >
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="PENDING">Pending</option>
                <option value="DISABLED">Disabled</option>
              </Select>
            </div>

            {error ? (
              <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
                {error}
              </p>
            ) : null}
            {saved ? (
              <p className="rounded-xl border border-mint/20 bg-mint-soft px-3 py-2 text-xs text-mint">
                Collection contract validated and saved.
              </p>
            ) : null}

            {canEdit ? (
              <div className="flex justify-end">
                <Button loading={busy} onClick={() => void save()}>
                  <Settings className="h-3.5 w-3.5" /> Validate &amp; save
                </Button>
              </div>
            ) : (
              <p className="text-[11px] text-muted">
                Only an ADMIN or OWNER can change the collection contract.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
