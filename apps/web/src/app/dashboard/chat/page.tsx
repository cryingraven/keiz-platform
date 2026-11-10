'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, MessageSquare, Plus, Search, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useAssistant } from '@/components/assistant';
import { useConfirm, useToast } from '@/components/feedback';
import { PageHeader } from '@/components/shell';
import { Button, Card, EmptyState, ErrorState, Input, Spinner } from '@/components/ui';

interface Thread {
  _id: string;
  title: string;
  updatedAt: string;
}

function updatedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ChatHistoryPage() {
  const threads = useApi<Thread[]>('/chat/threads');
  const { openAssistant, startNewChat } = useAssistant();
  const confirm = useConfirm();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = threads.data ?? [];
    if (!needle) return all;
    return all.filter((thread) => thread.title.toLowerCase().includes(needle));
  }, [threads.data, query]);

  async function remove(thread: Thread) {
    const ok = await confirm({
      title: 'Delete this conversation?',
      body: `"${thread.title}" and its messages will be removed. This cannot be undone.`,
      confirmLabel: 'Delete conversation',
      tone: 'danger',
    });
    if (!ok) return;
    setError(null);
    setDeleting(thread._id);
    try {
      await api(`/chat/threads/${thread._id}`, { method: 'DELETE' });
      await threads.reload();
      toast('Conversation deleted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the conversation');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Chat"
        description="Every conversation with the KEIZ assistant, scoped to this workspace."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <Input
                placeholder="Search conversations"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={startNewChat}>
              <Plus className="h-3.5 w-3.5" /> New chat
            </Button>
          </div>
        }
      />

      {error ? (
        <p className="mb-4 rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
          {error}
        </p>
      ) : null}

      {threads.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading conversations
        </div>
      ) : threads.error ? (
        <Card>
          <ErrorState message={threads.error} onRetry={() => void threads.reload()} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessageSquare className="h-5 w-5" />}
            title={query ? 'No matching conversations' : 'No conversations yet'}
            body={
              query
                ? 'Try a different search term.'
                : 'Ask the assistant about bills, receivables, payments or the books. Every conversation is saved here.'
            }
            action={
              query ? (
                <Button variant="secondary" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              ) : (
                <Button onClick={startNewChat}>
                  <Plus className="h-3.5 w-3.5" /> Start a chat
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-muted">
              {rows.length} conversation{rows.length === 1 ? '' : 's'}
            </p>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((thread) => (
              <li key={thread._id} className="group flex items-stretch">
                <button
                  type="button"
                  onClick={() => openAssistant(thread._id)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition hover:bg-paper"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                    <MessageSquare className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{thread.title}</span>
                    <span className="block text-[11px] text-muted">
                      Updated {updatedLabel(thread.updatedAt)}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted/50 transition group-hover:translate-x-0.5 group-hover:text-muted" />
                </button>
                <button
                  type="button"
                  onClick={() => void remove(thread)}
                  disabled={deleting === thread._id}
                  aria-label={`Delete ${thread.title}`}
                  className="flex w-11 shrink-0 items-center justify-center text-muted transition hover:bg-rose-soft hover:text-rose disabled:opacity-50"
                >
                  {deleting === thread._id ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
