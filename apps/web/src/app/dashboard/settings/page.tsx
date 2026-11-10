'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cable, Fingerprint, KeyRound, Settings, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useAuth, type PasskeySummary } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell';
import { useConfirm, useToast } from '@/components/feedback';
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
  const {
    session,
    passkeyBusy,
    passkeySupported,
    addPasskey,
    removePasskey,
    listPasskeys,
    exportRecoveryKey,
    error: authError,
  } = useAuth();
  const canEdit = ['ADMIN', 'OWNER'].includes(session?.role ?? '');
  const [form, setForm] = useState<Collection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const reloadPasskeys = useCallback(async () => {
    try {
      setPasskeys(await listPasskeys());
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : 'Could not load passkeys');
    }
  }, [listPasskeys]);

  useEffect(() => {
    void reloadPasskeys();
  }, [reloadPasskeys]);

  async function add() {
    setPasskeyError(null);
    await addPasskey();
    await reloadPasskeys();
    toast('Passkey added');
  }

  async function remove(id: string) {
    const last = passkeys.length <= 1;
    const ok = await confirm({
      title: last ? 'Remove your last passkey?' : 'Remove this passkey?',
      body: last
        ? 'This is your last passkey. Export your recovery key first, or you may be locked out of this account.'
        : 'Signing in with this passkey will stop working. Other passkeys are unaffected.',
      confirmLabel: 'Remove passkey',
      tone: 'danger',
    });
    if (!ok) return;
    setPasskeyError(null);
    await removePasskey(id, last);
    await reloadPasskeys();
    toast('Passkey removed');
  }

  async function exportKey() {
    setPasskeyError(null);
    try {
      setRecoveryKey(await exportRecoveryKey());
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : 'Could not export the recovery key');
    }
  }

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
      toast('Collection contract saved');
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
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Each workspace uses its own <span className="font-num">keiz-collect</span> contract.
              The API validates the contract&apos;s org id, treasury, token allowlist and code hash
              before saving it.
            </p>
            <p className="mt-1 font-num text-[11px] text-muted">
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
              <p className="text-[12px] text-muted">
                Only an ADMIN or OWNER can change the collection contract.
              </p>
            )}
          </div>
        )}
      </Card>

      <Card className="mt-5 max-w-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Fingerprint className="h-4 w-4 text-brand" /> Passkeys
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              A passkey signs you in and unlocks a NEAR key that exists only in your browser.
              Register a second passkey before removing the first one. Export the recovery key
              for a passkey account; a wallet account can always recover with its wallet.
              Removing a passkey does not revoke the on-chain key added by a wallet account —
              delete that key in the wallet if you want to revoke signing.
            </p>
            {session?.user ? (
              <p className="mt-1 font-num text-[11px] text-muted">
                Account: {session.user.accountId}
              </p>
            ) : null}
          </div>
          <Badge>{passkeys.length}</Badge>
        </div>

        {!passkeySupported ? (
          <p className="mt-4 rounded-xl border border-amber/20 bg-amber-soft px-3 py-2 text-xs text-amber">
            This browser does not support WebAuthn passkeys.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {passkeys.length === 0 ? (
              <p className="text-[13px] text-muted">
                No passkeys yet. Adding one from a wallet account asks the wallet to add the derived
                key on-chain first.
              </p>
            ) : (
              passkeys.map((passkey) => (
                <div
                  key={passkey.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-num text-[12px]">{passkey.credentialId}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {passkey.deviceType ?? 'passkey'} · {passkey.backedUp ? 'synced' : 'this device'}
                      {passkey.lastUsedAt ? ` · used ${new Date(passkey.lastUsedAt).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(passkey.id)}
                    disabled={passkeyBusy}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] text-muted transition hover:border-rose/30 hover:text-rose disabled:opacity-60"
                  >
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                </div>
              ))
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" loading={passkeyBusy} onClick={() => void add()}>
                <Fingerprint className="h-3.5 w-3.5" /> Add passkey
              </Button>
              <Button variant="ghost" loading={passkeyBusy} onClick={() => void exportKey()}>
                <KeyRound className="h-3.5 w-3.5" /> Export recovery key
              </Button>
            </div>

            {recoveryKey ? (
              <div className="rounded-xl border border-amber/20 bg-amber-soft p-3">
                <p className="text-[12px] font-medium text-amber">
                  Store this offline. Anyone with it controls the account.
                </p>
                <textarea
                  readOnly
                  value={recoveryKey}
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-amber/20 bg-white px-2 py-1.5 font-mono text-[11px] text-ink"
                />
              </div>
            ) : null}

            {passkeyError || authError ? (
              <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
                {passkeyError ?? authError}
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
