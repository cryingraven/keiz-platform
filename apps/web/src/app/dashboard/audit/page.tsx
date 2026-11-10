'use client';

import { useMemo, useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { PageHeader } from '@/components/shell';
import { Badge, Card, EmptyState, ErrorState, Input, TableSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

interface AuditEntry {
  _id: string;
  actorUserId?: string;
  accountId?: string;
  action: string;
  method: string;
  path: string;
  status: number;
  ip?: string;
  createdAt: string;
}

export default function AuditPage() {
  const audit = useApi<AuditEntry[]>('/audit');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return audit.data ?? [];
    return (audit.data ?? []).filter((entry) =>
      [entry.accountId, entry.action, entry.method, entry.path, String(entry.status)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [audit.data, query]);

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every mutating request, append-only and scoped to your workspace."
        actions={
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Search actor, path or status"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
            />
          </div>
        }
      />

      <Card className="overflow-hidden">
        {audit.loading ? (
          <TableSkeleton rows={7} cols={5} />
        ) : audit.error ? (
          <ErrorState message={audit.error} onRetry={() => void audit.reload()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-5 w-5" />}
            title={query ? 'No matches' : 'No audit events yet'}
            body={
              query
                ? 'Try a different search.'
                : 'Create a bill, approve it, or change a policy to see the first event.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Actor</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Path</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((entry) => (
                  <tr key={entry._id} className="text-[13px] transition hover:bg-paper/60">
                    <td className="whitespace-nowrap px-5 py-3 text-muted">
                      {new Date(entry.createdAt).toLocaleString('en-US')}
                    </td>
                    <td className="font-num max-w-[180px] truncate px-5 py-3">
                      {entry.accountId ?? entry.actorUserId ?? 'system'}
                    </td>
                    <td className="px-5 py-3">
                      <Badge className="border-line bg-paper capitalize text-muted">
                        {entry.method}
                      </Badge>
                    </td>
                    <td className="font-num max-w-[260px] truncate px-5 py-3 text-muted">
                      {entry.path}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          'font-num text-[12px] font-medium',
                          entry.status >= 400 ? 'text-rose' : 'text-mint',
                        )}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="font-num px-5 py-3 text-[12px] text-muted">{entry.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
