'use client';

import { useEffect, useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useToast } from '@/components/feedback';
import { Badge, Button, Card, Input, Label, Select } from '@/components/ui';

export type ArCollectionMode = 'CONTRACT' | 'TREASURY' | 'OFF';

export interface PaymentSettings {
  arMode: ArCollectionMode;
  configured: boolean;
  treasuryAccountId?: string;
  arAssetId?: string;
  collection: {
    contractId: string;
    status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'DISABLED';
    assetId: string;
    treasury: string;
  } | null;
}

interface TokenInfo {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
}

const MODE_LABELS: Record<ArCollectionMode, string> = {
  CONTRACT: 'Workspace contract (keiz-collect)',
  TREASURY: 'Treasury account (no contract)',
  OFF: 'Disabled',
};

export function PaymentSettingsCard({
  settings,
  loading,
  canEdit,
  accountId,
  onChanged,
}: {
  settings: PaymentSettings | null;
  loading: boolean;
  canEdit: boolean;
  accountId: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const tokens = useApi<TokenInfo[]>('/payments/tokens');
  const [mode, setMode] = useState<ArCollectionMode>('TREASURY');
  const [treasury, setTreasury] = useState('');
  const [assetId, setAssetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setMode(settings.arMode);
    setTreasury(settings.treasuryAccountId ?? accountId);
    setAssetId(settings.arAssetId ?? '');
  }, [settings, accountId]);

  const assets = useMemo(() => {
    const seen = new Set<string>();
    return (tokens.data ?? [])
      .filter(
        (token) =>
          token.blockchain.toLowerCase() === 'near' &&
          ['USDC', 'USDT'].includes(token.symbol.toUpperCase()) &&
          token.assetId.startsWith('nep141:'),
      )
      .filter((token) => {
        if (seen.has(token.assetId)) return false;
        seen.add(token.assetId);
        return true;
      });
  }, [tokens.data]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/orgs/current/payments', {
        method: 'PATCH',
        body: JSON.stringify({
          arMode: mode,
          treasuryAccountId: treasury.trim() || undefined,
          arAssetId: assetId || undefined,
        }),
      });
      toast('Payment settings saved');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save payment settings');
    } finally {
      setBusy(false);
    }
  }

  const contract = settings?.collection;

  return (
    <Card className="mt-5 max-w-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Wallet className="h-4 w-4 text-brand" /> AR collection mode
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Receive customer payments into a workspace contract or directly into a NEAR
            treasury account. Contracts are optional.
          </p>
        </div>
        <Badge>{settings?.arMode ?? '—'}</Badge>
      </div>

      {loading ? (
        <p className="mt-4 text-[13px] text-muted">Loading payment settings…</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="p-mode">Collection mode</Label>
            <Select
              id="p-mode"
              value={mode}
              disabled={!canEdit}
              onChange={(event) => setMode(event.target.value as ArCollectionMode)}
            >
              {(Object.keys(MODE_LABELS) as ArCollectionMode[]).map((value) => (
                <option key={value} value={value}>
                  {MODE_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>

          {mode === 'TREASURY' ? (
            <>
              <div>
                <Label htmlFor="p-treasury">Treasury account</Label>
                <Input
                  id="p-treasury"
                  value={treasury}
                  disabled={!canEdit}
                  placeholder="treasury.near"
                  onChange={(event) => setTreasury(event.target.value)}
                />
                <p className="mt-1 text-[11px] text-muted">
                  Customer payments arrive directly in this NEAR account. Keep it under the
                  workspace&apos;s control.
                </p>
              </div>
              <div>
                <Label htmlFor="p-asset">Settlement asset</Label>
                <Select
                  id="p-asset"
                  value={assetId}
                  disabled={!canEdit}
                  onChange={(event) => setAssetId(event.target.value)}
                >
                  <option value="">Default (USDC on NEAR)</option>
                  {assets.map((asset) => (
                    <option key={asset.assetId} value={asset.assetId}>
                      {asset.symbol} · {asset.assetId}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          ) : null}

          {mode === 'CONTRACT' ? (
            <p className="rounded-xl border border-line bg-paper px-3 py-2 text-[12px] text-muted">
              {contract?.status === 'ACTIVE'
                ? `Collection uses ${contract.contractId}. Receipts are indexed from the contract.`
                : 'No active contract yet. Deploy one below or activate an existing contract.'}
            </p>
          ) : null}

          {mode === 'OFF' ? (
            <p className="rounded-xl border border-line bg-paper px-3 py-2 text-[12px] text-muted">
              On-chain collection is hidden and the collection-quote endpoint is rejected.
            </p>
          ) : null}

          {error ? (
            <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
              {error}
            </p>
          ) : null}

          {canEdit ? (
            <div className="flex justify-end">
              <Button loading={busy} onClick={() => void save()}>
                Save payment settings
              </Button>
            </div>
          ) : (
            <p className="text-[12px] text-muted">
              Only an ADMIN or OWNER can change payment settings.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
