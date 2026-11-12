'use client';

import { useEffect, useRef, useState } from 'react';
import { Rocket, ShieldCheck } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useToast } from '@/components/feedback';
import { Badge, Button, Card, Input, Label, Modal, Select, Spinner } from '@/components/ui';

export interface CollectionConfig {
  contractId: string;
  network: 'mainnet' | 'testnet';
  treasury: string;
  assetId: string;
  tokenContract: string;
  decimals: number;
  status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'DISABLED';
  validatedAt?: string;
}

interface DeployAsset {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  tokenContract: string;
}

type DeployStatus =
  | 'QUEUED'
  | 'DEPLOYING'
  | 'ALLOWLISTING'
  | 'TRANSFERRING'
  | 'VERIFYING'
  | 'ACTIVE'
  | 'FAILED';

interface DeployStep {
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  txHash?: string;
  error?: string;
  at?: string;
}

export interface CollectionDeployment {
  _id: string;
  status: DeployStatus;
  contractId: string;
  treasury: string;
  assetId: string;
  tokenContract: string;
  decimals: number;
  steps: Record<string, DeployStep>;
  txHashes: string[];
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

interface Capabilities {
  enabled: boolean;
  reason?: string;
  network: 'mainnet' | 'testnet';
  deployerAccount: string | null;
  codeHash: string | null;
  fundingNear: string;
  assets: DeployAsset[];
  latest: CollectionDeployment | null;
}

const STEP_LABELS: Record<string, string> = {
  account: 'Create account and deploy code',
  allowlist: 'Register token and allowlist it',
  ownership: 'Hand ownership to you',
  verify: 'Verify and activate',
};

const TERMINAL: DeployStatus[] = ['ACTIVE', 'FAILED'];

export function DeployCollectionCard({
  collection,
  slug,
  accountId,
  canEdit,
  onChanged,
}: {
  collection: CollectionConfig | null;
  slug: string;
  accountId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const capabilities = useApi<Capabilities>('/orgs/current/collection/deploy', {
    pollMs: 5_000,
  });
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [treasury, setTreasury] = useState(accountId);
  const [prefix, setPrefix] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployId, setDeployId] = useState<string | null>(null);

  const latest = capabilities.data?.latest ?? null;
  const watching =
    deployId ?? (latest && !TERMINAL.includes(latest.status) ? latest._id : null);
  const deployment = useApi<CollectionDeployment>(
    watching ? `/orgs/current/collection/deploy/${watching}` : null,
    { pollMs: 2_000 },
  );
  const current = deployment.data ?? latest;
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!current) return;
    if (current.status === 'ACTIVE' && deployId && done.current !== current._id) {
      done.current = current._id;
      setDeployId(null);
      toast('Collection contract deployed and activated');
      onChanged();
      void capabilities.reload();
    }
    if (current.status === 'FAILED' && done.current !== `failed:${current._id}`) {
      done.current = `failed:${current._id}`;
      void capabilities.reload();
    }
  }, [current, deployId, capabilities.reload, onChanged, toast]);

  const assets = capabilities.data?.assets ?? [];
  const selectedAsset =
    assets.find((asset) => asset.assetId === assetId) ?? assets[0];

  function openDeploy() {
    setError(null);
    setDeployId(null);
    setAssetId(capabilities.data?.assets[0]?.assetId ?? '');
    setTreasury(accountId);
    setPrefix(`${slug}-collect`.slice(0, 32).replace(/-+$/, ''));
    setOpen(true);
  }

  async function start() {
    if (!selectedAsset) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ deploymentId: string; resumed: boolean }>(
        '/orgs/current/collection/deploy',
        {
          method: 'POST',
          body: JSON.stringify({
            assetId: selectedAsset.assetId,
            treasury: treasury.trim() || undefined,
            prefix: prefix.trim() || undefined,
          }),
        },
      );
      setDeployId(result.deploymentId);
      setOpen(false);
      toast(result.resumed ? 'Resuming the current deployment' : 'Deployment started');
      void capabilities.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the deployment');
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/orgs/current/collection/deploy/${current._id}/retry`, {
        method: 'POST',
      });
      setDeployId(current._id);
      toast('Retrying the deployment');
      void capabilities.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not retry the deployment');
    } finally {
      setBusy(false);
    }
  }

  const running = current ? !TERMINAL.includes(current.status) : false;

  return (
    <Card className="mt-5 max-w-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Rocket className="h-4 w-4 text-brand" /> One-click deployment
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Deploy a workspace-owned <span className="font-num">keiz-collect</span> contract,
            allowlist USDC/USDT and hand the owner key to your account. KEIZ pays the
            deployment storage.
          </p>
        </div>
        {collection?.status ? <Badge>{collection.status}</Badge> : null}
      </div>

      {capabilities.loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Spinner /> Checking deployment support
        </div>
      ) : !capabilities.data?.enabled ? (
        <p className="mt-4 rounded-xl border border-line bg-paper px-3 py-2 text-[12px] text-muted">
          {capabilities.data?.reason ?? 'One-click deployment is unavailable on this server.'} You
          can still activate an existing contract in the form below.
        </p>
      ) : collection?.status === 'ACTIVE' ? (
        <p className="mt-4 rounded-xl border border-mint/20 bg-mint-soft px-3 py-2 text-[12px] text-mint">
          {collection.contractId} is active. Deploy a new contract only after pausing or disabling
          this one.
        </p>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[12px] text-muted">
            {canEdit
              ? `Deployer ${capabilities.data.deployerAccount ?? '—'} · about ${capabilities.data.fundingNear} NEAR of storage`
              : 'Only an ADMIN or OWNER can deploy the collection contract.'}
          </p>
          {canEdit ? (
            <Button onClick={openDeploy} disabled={running}>
              <Rocket className="h-3.5 w-3.5" /> Deploy with KEIZ
            </Button>
          ) : null}
        </div>
      )}

      {current ? (
        <div className="mt-4 rounded-xl border border-line bg-paper px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium">
                {current.contractId || 'Preparing contract account'}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                {running ? 'Deployment in progress — this can take a minute.' : current.status}
              </p>
            </div>
            {running ? <Spinner /> : <Badge>{current.status}</Badge>}
          </div>

          <ul className="mt-3 space-y-2">
            {Object.entries(STEP_LABELS).map(([key, label]) => {
              const step = current.steps?.[key] ?? { status: 'PENDING' as const };
              return (
                <li key={key} className="flex items-start gap-2 text-[12px]">
                  <span
                    className={
                      step.status === 'DONE'
                        ? 'mt-0.5 h-2 w-2 shrink-0 rounded-full bg-mint'
                        : step.status === 'FAILED'
                          ? 'mt-0.5 h-2 w-2 shrink-0 rounded-full bg-rose'
                          : step.status === 'RUNNING'
                            ? 'mt-0.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand'
                            : 'mt-0.5 h-2 w-2 shrink-0 rounded-full bg-line'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className={step.status === 'PENDING' ? 'text-muted' : ''}>{label}</p>
                    {step.txHash ? (
                      <a
                        href={explorerUrl(capabilities.data?.network ?? 'mainnet', step.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-num block truncate text-[11px] text-brand hover:underline"
                      >
                        {step.txHash}
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {current.error ? (
            <p className="mt-2 rounded-lg border border-rose/20 bg-rose-soft px-2.5 py-2 text-[11px] text-rose">
              {current.error}
            </p>
          ) : null}
          {current.status === 'FAILED' && canEdit ? (
            <div className="mt-2 flex justify-end">
              <Button variant="secondary" loading={busy} onClick={() => void retry()}>
                Retry deployment
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Deploy collection contract"
        description="KEIZ creates a subaccount, deploys the audited keiz-collect wasm, allowlists the token and transfers ownership to you."
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="d-asset">Collection token</Label>
            <Select
              id="d-asset"
              value={selectedAsset?.assetId ?? ''}
              onChange={(event) => setAssetId(event.target.value)}
            >
              {assets.map((asset) => (
                <option key={asset.assetId} value={asset.assetId}>
                  {asset.symbol} · {asset.tokenContract}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="d-treasury">Treasury account</Label>
            <Input
              id="d-treasury"
              value={treasury}
              onChange={(event) => setTreasury(event.target.value)}
              placeholder="you.near"
            />
            <p className="mt-1 text-[11px] text-muted">
              Where swept funds go. Defaults to your signed-in account.
            </p>
          </div>
          <div>
            <Label htmlFor="d-prefix">Contract name</Label>
            <Input
              id="d-prefix"
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
              placeholder={`${slug}-collect`}
            />
            <p className="font-num mt-1 text-[11px] text-muted">
              {prefix || `${slug}-collect`}.{capabilities.data?.deployerAccount ?? 'deployer.near'}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-paper px-3 py-2 text-[11px] text-muted">
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <ShieldCheck className="h-3.5 w-3.5 text-mint" /> What happens
            </span>
            <p className="mt-1">
              Owner becomes <span className="font-num">{accountId}</span>. No key is added to the
              contract account, so only your account can call owner methods.
            </p>
          </div>
          {error ? (
            <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!selectedAsset || !treasury.trim()}
              onClick={() => void start()}
            >
              Deploy and activate
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function explorerUrl(network: 'mainnet' | 'testnet', hash: string): string {
  return network === 'testnet'
    ? `https://testnet.nearblocks.io/txns/${hash}`
    : `https://nearblocks.io/txns/${hash}`;
}
