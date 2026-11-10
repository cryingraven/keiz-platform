'use client';

import { useMemo, useState } from 'react';
import { Briefcase, Check, Play, X } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useToast } from '@/components/feedback';
import { Badge, Button, Card, EmptyState, SectionTitle, Spinner, StatusPill } from '@/components/ui';

interface Provider {
  _id: string;
  slug: string;
  name: string;
  description: string;
  capability: string;
  priceUsd: string;
  active: boolean;
}

interface Job {
  _id: string;
  providerName: string;
  capability: string;
  title: string;
  task: string;
  costUsd: string;
  status: string;
  payment?: { method?: string; status?: string };
  resultSummary?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export function AgentEconomy({ canAdmin }: { canAdmin: boolean }) {
  const providers = useApi<Provider[]>('/agent/providers');
  const jobs = useApi<Job[]>('/agent/jobs');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const rows = jobs.data ?? [];
    const completed = rows.filter((job) => job.status === 'DONE');
    return {
      completed: completed.length,
      spent: completed.reduce((sum, job) => sum + Number(job.costUsd || 0), 0),
      activeProviders: (providers.data ?? []).filter((provider) => provider.active).length,
    };
  }, [jobs.data, providers.data]);

  async function run(job: Job, action: 'approve' | 'execute' | 'cancel') {
    setBusy(`${job._id}:${action}`);
    setError(null);
    try {
      await api(`/agent/jobs/${job._id}/${action}`, { method: 'POST' });
      await jobs.reload();
      toast(
        action === 'approve'
          ? 'Agent hire approved'
          : action === 'execute'
            ? 'Agent job executed'
            : 'Agent hire cancelled',
        action === 'cancel' ? 'info' : 'success',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent job action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle
            title="Agent economy"
            hint="Hired specialists, mock settlement, workspace policy"
          />
          <Badge className="border-line bg-paper text-muted">Mock settlement</Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-paper px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-muted">Completed jobs</p>
            <p className="font-num mt-1 text-lg font-semibold">{stats.completed}</p>
          </div>
          <div className="rounded-xl bg-paper px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-muted">Spent on agents</p>
            <p className="font-num mt-1 text-lg font-semibold">${stats.spent.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-paper px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-muted">Providers</p>
            <p className="font-num mt-1 text-lg font-semibold">{stats.activeProviders}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(providers.data ?? []).map((provider) => (
            <div key={provider._id} className="rounded-xl border border-line px-3 py-2.5">
              <p className="truncate text-[12px] font-medium">{provider.name}</p>
              <p className="truncate text-[11px] text-muted">{provider.capability}</p>
              <p className="font-num mt-1 text-[12px]">${provider.priceUsd}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted">
          Ask the assistant to “hire the tax reviewer for INV-1001” to run a job. Hires are
          policy-checked and currently settle in mock mode.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <SectionTitle title="Agent hires" hint="Provider, cost, result and policy state" />
        </div>
        {error ? (
          <p className="border-b border-line bg-rose-soft px-5 py-2 text-[11px] text-rose">
            {error}
          </p>
        ) : null}
        {jobs.loading ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
            <Spinner /> Loading hires
          </div>
        ) : (jobs.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Briefcase className="h-5 w-5" />}
            title="No agent hires yet"
            body="Ask the assistant to hire a specialist. The job, cost and provider result appear here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {(jobs.data ?? []).map((job) => (
              <li key={job._id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{job.providerName}</p>
                    <p className="truncate text-[11px] text-muted">{job.task}</p>
                  </div>
                  <span className="font-num text-[13px]">${job.costUsd}</span>
                  <StatusPill status={job.status} />
                </div>
                {job.resultSummary ? (
                  <p className="mt-1.5 rounded-lg bg-paper px-2.5 py-2 text-[11px] leading-relaxed text-muted">
                    {job.resultSummary}
                  </p>
                ) : job.error ? (
                  <p className="mt-1.5 text-[11px] text-rose">{job.error}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {canAdmin && job.status === 'PENDING_APPROVAL' ? (
                    <>
                      <Button
                        size="sm"
                        loading={busy === `${job._id}:approve`}
                        onClick={() => void run(job, 'approve')}
                      >
                        <Check className="h-3 w-3" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === `${job._id}:cancel`}
                        onClick={() => void run(job, 'cancel')}
                      >
                        <X className="h-3 w-3" /> Cancel
                      </Button>
                    </>
                  ) : null}
                  {canAdmin && job.status === 'APPROVED' ? (
                    <>
                      <Button
                        size="sm"
                        loading={busy === `${job._id}:execute`}
                        onClick={() => void run(job, 'execute')}
                      >
                        <Play className="h-3 w-3" /> Run job
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === `${job._id}:cancel`}
                        onClick={() => void run(job, 'cancel')}
                      >
                        <X className="h-3 w-3" /> Cancel
                      </Button>
                    </>
                  ) : null}
                  {job.status === 'DONE' ? (
                    <span className="text-[11px] text-muted">
                      Settled · {job.payment?.method ?? 'mock'} · {job.payment?.status ?? 'PAID'}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
