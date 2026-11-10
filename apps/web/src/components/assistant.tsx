'use client';

import Link from 'next/link';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Bot,
  Building2,
  CheckCircle2,
  Contact,
  CornerDownLeft,
  Cpu,
  FileText,
  History,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Minimize2,
  Receipt,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  fetchPendingApprovals,
  streamChat,
  streamChatApproval,
} from '@/lib/chat-stream';
import { Button, Input, Spinner } from '@/components/ui';
import { useConfirm } from '@/components/feedback';
import { cn } from '@/lib/utils';
import { ApprovalCard, ChatCardView, PlanCard } from '@/components/chat/cards';
import {
  chatCardSchema,
  type ChatApprovalRequest,
  type ChatCard,
  type ChatPlan,
  type ChatStreamEvent,
} from '@keiz/shared';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'calling' | 'done' | 'error';
}

interface ApprovalState {
  request: ChatApprovalRequest;
  busy?: boolean;
  resolved?: { approved: boolean; reason?: string };
}

type MessagePhase = 'planning' | 'executing' | 'awaiting-approval' | 'final';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  cards?: ChatCard[];
  plan?: ChatPlan;
  approvals?: ApprovalState[];
  phase?: MessagePhase;
  at?: string;
}

interface Thread {
  _id: string;
  title: string;
  updatedAt: string;
}

interface ThreadDetail {
  _id: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
  }>;
}

const SUGGESTIONS = [
  'Spend summary for this workspace',
  'Show invoices waiting for approval',
  'Pay INV-1001',
  'Which vendors do we have?',
];

const CREATE_ACTIONS = [
  {
    label: 'Vendor',
    prompt:
      'I want to create a vendor. Ask me for the name, email, payout chain and payout address before calling the plan.',
    icon: Building2,
    requiresAdmin: true,
  },
  {
    label: 'Customer',
    prompt:
      'I want to create a customer. Ask me for the name and email before calling the plan.',
    icon: Contact,
  },
  {
    label: 'AP bill',
    prompt:
      'I want to create a vendor bill. Ask me for the vendor, line items, currency, tax and due date before calling the plan.',
    icon: FileText,
  },
  {
    label: 'AR invoice',
    prompt:
      'I want to create a customer invoice. Ask me for the customer, line items, currency, tax and due date before calling the plan.',
    icon: Receipt,
  },
];

interface AssistantContextValue {
  open: boolean;
  openAssistant: (threadId?: string) => void;
  startNewChat: () => void;
  closeAssistant: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const context = useContext(AssistantContext);
  if (!context) throw new Error('useAssistant must be used inside AssistantProvider');
  return context;
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(null);
  const [newChatKey, setNewChatKey] = useState(0);
  const openAssistant = useCallback((threadId?: string) => {
    setRequestedThreadId(threadId ?? null);
    setOpen(true);
  }, []);
  const startNewChat = useCallback(() => {
    setRequestedThreadId(null);
    setNewChatKey((key) => key + 1);
    setOpen(true);
  }, []);
  const closeAssistant = useCallback(() => setOpen(false), []);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <AssistantContext.Provider
      value={{ open, openAssistant, startNewChat, closeAssistant }}
    >
      {children}

      {!open ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => openAssistant()}
          aria-label="Open assistant"
          aria-haspopup="dialog"
          aria-expanded="false"
          className="group fixed bottom-5 right-5 z-40 grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-ink shadow-panel transition hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:bottom-6 sm:right-6"
        >
          <MessageSquare className="h-4 w-4" />
          <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-control border border-line bg-surface px-2 py-1 text-meta font-medium text-ink opacity-0 shadow-panel transition group-hover:opacity-100 sm:block">
            Ask KEIZ
          </span>
        </button>
      ) : null}

      <AssistantDialog
        open={open}
        requestedThreadId={requestedThreadId}
        newChatKey={newChatKey}
        onClose={closeAssistant}
      />
    </AssistantContext.Provider>
  );
}

function AssistantDialog({
  open,
  requestedThreadId,
  newChatKey,
  onClose,
}: {
  open: boolean;
  requestedThreadId: string | null;
  newChatKey: number;
  onClose: () => void;
}) {
  const threads = useApi<Thread[]>(open ? '/chat/threads' : null);
  const { session } = useAuth();
  const canAdmin = ['ADMIN', 'OWNER'].includes(session?.role ?? '');
  const createActions = CREATE_ACTIONS.filter(
    (action) => !('requiresAdmin' in action) || !action.requiresAdmin || canAdmin,
  );
  const [threadId, setThreadId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const confirm = useConfirm();

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedRequestRef = useRef<string | null>(null);
  const seenNewChatKeyRef = useRef(newChatKey);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    composerRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setHistoryOpen(false);
      setExpanded(false);
    }
  }, [open]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streaming, open, historyOpen]);

  function applyEvent(event: ChatStreamEvent) {
    if (event.type === 'meta') {
      setProvider(event.provider);
      setModelId(event.modelId);
      return;
    }
    if (event.type === 'thread') {
      setThreadId(event.threadId);
      return;
    }
    if (event.type === 'error') {
      setError(event.message);
      return;
    }
    if (event.type === 'done') {
      setStreaming(false);
      setMessages((current) => {
        if (current.length === 0) return current;
        const next = [...current];
        const last = next[next.length - 1];
        if (last.role !== 'assistant') return current;
        const waiting = (last.approvals ?? []).some((approval) => !approval.resolved);
        next[next.length - 1] = {
          ...last,
          phase: event.suspended
            ? waiting
              ? 'awaiting-approval'
              : 'executing'
            : 'final',
        };
        return next;
      });
      return;
    }
    setMessages((current) => {
      if (current.length === 0) return current;
      const next = [...current];
      const index = next.length - 1;
      const last = next[index];
      if (last.role !== 'assistant') return current;

      if (event.type === 'text') {
        next[index] = { ...last, content: last.content + event.delta, phase: 'final' };
      } else if (event.type === 'tool' && event.phase === 'call') {
        next[index] = {
          ...last,
          toolCalls: [
            ...(last.toolCalls ?? []),
            { name: event.name, args: event.args, status: 'calling' },
          ],
        };
      } else if (event.type === 'tool' && event.phase === 'result') {
        const calls = [...(last.toolCalls ?? [])];
        for (let i = calls.length - 1; i >= 0; i -= 1) {
          if (calls[i].name === event.name && calls[i].status === 'calling') {
            calls[i] = { ...calls[i], result: event.result, status: 'done' };
            break;
          }
        }
        next[index] = { ...last, toolCalls: calls };
      } else if (event.type === 'plan') {
        next[index] = { ...last, plan: event.plan, phase: 'planning' };
      } else if (event.type === 'card') {
        next[index] = { ...last, cards: [...(last.cards ?? []), event.card] };
      } else if (event.type === 'approval') {
        next[index] = {
          ...last,
          plan:
            event.approval.name === 'plan-actions' && last.plan
              ? { ...last.plan, id: event.approval.toolCallId, status: 'pending' }
              : last.plan,
          approvals: [
            ...(last.approvals ?? []),
            { request: event.approval },
          ],
          phase: 'awaiting-approval',
        };
      } else if (event.type === 'approval_result') {
        const isPlan = last.plan?.id === event.toolCallId;
        next[index] = {
          ...last,
          phase: isPlan ? (event.approved ? 'executing' : 'final') : 'executing',
          plan:
            last.plan?.id === event.toolCallId
              ? {
                  ...last.plan,
                  status: event.approved ? 'approved' : 'declined',
                }
              : last.plan,
          approvals: (last.approvals ?? []).map((approval) =>
            approval.request.toolCallId === event.toolCallId
              ? {
                  ...approval,
                  busy: false,
                  resolved: { approved: event.approved, reason: event.reason },
                }
              : approval,
          ),
        };
      }
      return next;
    });
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || streaming) return;

    setInput('');
    setError(null);
    setStreaming(true);
    setMessages((current) => [
      ...current,
      { role: 'user', content: message },
      { role: 'assistant', content: '', toolCalls: [], phase: 'planning' },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat({
        message,
        threadId,
        signal: controller.signal,
        onEvent: applyEvent,
      });
      void threads.reload();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'The assistant could not answer');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setMessages((current) => {
        if (current.length === 0) return current;
        const next = [...current];
        const last = next[next.length - 1];
        if (
          last.role === 'assistant' &&
          !last.content &&
          (last.toolCalls?.length ?? 0) === 0 &&
          (last.cards?.length ?? 0) === 0 &&
          !last.plan &&
          (last.approvals?.length ?? 0) === 0
        ) {
          next[next.length - 1] = { ...last, content: 'No response.' };
        }
        return next;
      });
    }
  }

  async function respondToApproval(
    approval: ChatApprovalRequest,
    approved: boolean,
    reason?: string,
  ) {
    if (streaming) return;
    setError(null);
    setStreaming(true);
    setMessages((current) =>
      current.map((message) => ({
        ...message,
        approvals: (message.approvals ?? []).map((item) =>
          item.request.toolCallId === approval.toolCallId
            ? { ...item, busy: true }
            : item,
        ),
      })),
    );

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChatApproval({
        approval,
        approved,
        reason,
        signal: controller.signal,
        onEvent: applyEvent,
      });
      void threads.reload();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'The approval could not be applied');
      }
      setMessages((current) =>
        current.map((message) => ({
          ...message,
          approvals: (message.approvals ?? []).map((item) =>
            item.request.toolCallId === approval.toolCallId
              ? { ...item, busy: false }
              : item,
          ),
        })),
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  function newThread() {
    stop();
    setThreadId(undefined);
    setMessages([]);
    setError(null);
    setHistoryOpen(false);
    composerRef.current?.focus();
  }

  function retry() {
    const last = [...messages].reverse().find((message) => message.role === 'user');
    if (last) void send(last.content);
  }

  async function deleteThread(thread: Thread) {
    const ok = await confirm({
      title: 'Delete this conversation?',
      body: `"${thread.title}" and its messages will be removed. This cannot be undone.`,
      confirmLabel: 'Delete conversation',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api(`/chat/threads/${thread._id}`, { method: 'DELETE' });
      if (threadId === thread._id) {
        setThreadId(undefined);
        setMessages([]);
      }
      await threads.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the thread');
    }
  }

  async function loadThread(id: string) {
    setHistoryOpen(false);
    try {
      const detail = await api<ThreadDetail>(`/chat/threads/${id}`);
      setThreadId(id);
      setError(null);
      const loaded: Message[] = (detail.messages ?? []).map((message) => {
        const toolCalls = (message.toolCalls ?? []).map((call) => ({
          name: call.name,
          args: call.args,
          result: call.result,
          status: 'done' as const,
        }));
        const cards: ChatCard[] = [];
        for (const call of toolCalls) {
          const parsed = chatCardSchema.safeParse(call.result);
          if (parsed.success) cards.push(parsed.data);
        }
        const planCall = toolCalls.find((call) => call.name === 'plan-actions');
        const plan = planCall
          ? {
              id: `history-${planCall.args.__toolCallId ?? message.role}`,
              goal: String(planCall.args.goal ?? 'Action plan'),
              summary:
                typeof planCall.args.summary === 'string' ? planCall.args.summary : undefined,
              steps: Array.isArray(planCall.args.steps)
                ? (planCall.args.steps as ChatPlan['steps'])
                : [],
              status: 'approved' as const,
            }
          : undefined;
        return {
          role: message.role,
          content: message.content,
          toolCalls,
          cards,
          plan,
          phase: 'final' as const,
        };
      });
      setMessages(loaded);
      const pending = await fetchPendingApprovals(id);
      if (pending.length) {
        const planRequest = pending.find((request) => request.name === 'plan-actions');
        const pendingPlan: ChatPlan | undefined = planRequest
          ? {
              id: planRequest.toolCallId,
              goal: String(planRequest.args.goal ?? 'Action plan'),
              summary:
                typeof planRequest.args.summary === 'string'
                  ? planRequest.args.summary
                  : undefined,
              steps: Array.isArray(planRequest.args.steps)
                ? (planRequest.args.steps as ChatPlan['steps'])
                : [],
              status: 'pending',
            }
          : undefined;
        setMessages((current) => {
          if (current.length === 0) {
            return [
              {
                role: 'assistant',
                content: '',
                plan: pendingPlan,
                approvals: pending.map((request) => ({ request })),
                phase: 'awaiting-approval',
              },
            ];
          }
          const next = [...current];
          const last = next[next.length - 1];
          if (last.role !== 'assistant') return current;
          next[next.length - 1] = {
            ...last,
            plan: pendingPlan ?? last.plan,
            approvals: pending.map((request) => ({ request })),
            phase: 'awaiting-approval',
          };
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the thread');
    }
  }

  useEffect(() => {
    if (!open) {
      loadedRequestRef.current = null;
      return;
    }
    if (newChatKey !== seenNewChatKeyRef.current) {
      seenNewChatKeyRef.current = newChatKey;
      loadedRequestRef.current = null;
      stop();
      setThreadId(undefined);
      setMessages([]);
      setError(null);
      setHistoryOpen(false);
      return;
    }
    if (!requestedThreadId) return;
    if (loadedRequestRef.current === requestedThreadId) return;
    loadedRequestRef.current = requestedThreadId;
    void loadThread(requestedThreadId);
  }, [open, requestedThreadId, newChatKey]);

  const providerLabel =
    provider === 'local'
      ? 'Local fallback · set NEARAI_API_KEY for NEAR AI'
      : provider === 'mastra'
        ? (modelId ?? 'NEAR AI Cloud')
        : 'Agent · tools scoped to your workspace';

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm sm:flex sm:p-6',
        expanded ? 'sm:items-center sm:justify-center' : 'sm:items-end sm:justify-end',
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-title"
        className={cn(
          'absolute inset-0 flex flex-col overflow-hidden bg-surface sm:static sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl',
          expanded
            ? 'sm:h-[calc(100dvh-3rem)] sm:w-[min(1100px,calc(100vw-3rem))]'
            : 'sm:h-[min(680px,calc(100dvh-3rem))] sm:w-[min(440px,calc(100vw-3rem))]',
        )}
      >
        <div className="relative flex items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
              <Bot className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 id="assistant-title" className="text-[14px] font-semibold">
                KEIZ assistant
              </h2>
              <p className="truncate text-[11px] text-muted">{providerLabel}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-label={expanded ? 'Restore assistant size' : 'Expand assistant'}
              aria-pressed={expanded}
              className="hidden rounded-lg p-2 text-muted transition hover:bg-paper hover:text-ink sm:inline-flex"
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              aria-label={historyOpen ? 'Back to conversation' : 'Conversation history'}
              aria-expanded={historyOpen}
              aria-controls="assistant-history"
              className={cn(
                'rounded-lg p-2 text-muted transition hover:bg-paper hover:text-ink',
                historyOpen && 'bg-paper text-ink',
              )}
            >
              <History className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={newThread}
              aria-label="New thread"
              className="rounded-lg p-2 text-muted transition hover:bg-paper hover:text-ink"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close assistant"
              className="rounded-lg p-2 text-muted transition hover:bg-paper hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {historyOpen ? (
          <div id="assistant-history" className="flex min-h-0 flex-1 flex-col">
            {threads.loading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
                <Spinner /> Loading conversations
              </div>
            ) : threads.error ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-[13px] text-rose">{threads.error}</p>
                <Button size="sm" variant="secondary" onClick={() => void threads.reload()}>
                  Retry
                </Button>
              </div>
            ) : (threads.data?.length ?? 0) === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-paper text-muted">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <p className="mt-1 text-sm font-semibold">No conversations yet</p>
                <p className="max-w-xs text-[13px] text-muted">
                  Ask the assistant about bills, receivables or the books. The conversation will
                  appear here.
                </p>
                <Button size="sm" onClick={newThread} className="mt-1">
                  <MessageSquarePlus className="h-3.5 w-3.5" /> Start a chat
                </Button>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto scroll-thin">
                {(threads.data ?? []).map((thread) => (
                  <li
                    key={thread._id}
                    className="flex items-stretch border-b border-line last:border-0"
                  >
                    <button
                      type="button"
                      onClick={() => void loadThread(thread._id)}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition hover:bg-paper',
                        threadId === thread._id && 'bg-paper',
                      )}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                        <MessageSquare className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {thread.title}
                        </span>
                        <span className="block text-[11px] text-muted">
                          Updated{' '}
                          {new Date(thread.updatedAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteThread(thread)}
                      aria-label={`Delete ${thread.title}`}
                      className="flex w-11 shrink-0 items-center justify-center text-muted transition hover:bg-rose-soft hover:text-rose"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-line px-4 py-2">
              <Link
                href="/dashboard/chat"
                onClick={onClose}
                className="text-[12px] font-medium text-brand hover:underline"
              >
                Open full history
              </Link>
            </div>
          </div>
        ) : (
          <>
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-4 py-4 scroll-thin sm:px-5 sm:py-5"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {messages.length === 0 ? (
            <div className="mx-auto max-w-md py-4">
              <div className="text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-paper">
                  <Sparkles className="h-5 w-5 text-brand" />
                </span>
                <p className="mt-3 text-sm font-semibold">Ask or create</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Chat can create vendors, customers, AP bills and AR invoices. Everything is
                  confirmed before it is written.
                </p>
              </div>

              <div className="mt-5">
                <p className="text-[11px] uppercase tracking-wider text-muted">Create</p>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {createActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.label}
                        type="button"
                        onClick={() => void send(action.prompt)}
                        className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-[12px] font-medium transition hover:border-line-strong hover:bg-paper"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block">{action.label}</span>
                          <span className="block truncate text-[10px] font-normal text-muted">
                            Confirm before writing
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {provider === 'local' ? (
                  <p className="mt-2 text-[11px] text-muted">
                    Creating records needs the NEAR AI agent. Set NEARAI_API_KEY to enable it.
                  </p>
                ) : null}
              </div>

              <div className="mt-5">
                <p className="text-[11px] uppercase tracking-wider text-muted">Ask</p>
                <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-muted transition hover:border-line-strong hover:text-ink"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((message, index) => {
              const isLast = index === messages.length - 1;
              const planApproval = message.approvals?.find(
                (approval) => approval.request.name === 'plan-actions',
              );
              const phase = message.phase ?? 'final';
              const isFinal = phase === 'final';
              const showPlan = Boolean(message.plan) && !isFinal;
              const pendingWrite = message.approvals?.find(
                (approval) =>
                  approval.request.name !== 'plan-actions' && !approval.resolved,
              );
              return (
                <div
                  key={index}
                  className={cn(
                    'flex gap-2.5',
                    message.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  {message.role === 'assistant' ? (
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                      <Bot className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                  <div
                    className={cn(
                      'max-w-[82%] rounded-2xl px-3.5 py-2.5',
                      message.role === 'user'
                        ? 'bg-ink text-white'
                        : 'border border-line bg-paper text-ink',
                    )}
                  >
                    {message.content ? (
                      <div className="whitespace-pre-wrap text-[14px] leading-relaxed">
                        <MarkdownText content={message.content} />
                        {streaming && isLast && message.role === 'assistant' ? (
                          <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-ink align-middle" />
                        ) : null}
                      </div>
                    ) : streaming && isLast && !message.plan && phase !== 'final' ? (
                      <span className="flex items-center gap-2 text-[13px] text-muted">
                        <Spinner className="h-3 w-3" /> Preparing…
                      </span>
                    ) : null}

                    {isFinal
                      ? message.cards?.map((card, cardIndex) => (
                          <ChatCardView key={`${card.kind}-${cardIndex}`} card={card} />
                        ))
                      : null}

                    {showPlan ? (
                      <PlanCard
                        plan={message.plan!}
                        busy={planApproval?.busy}
                        onApprove={
                          planApproval
                            ? () => void respondToApproval(planApproval.request, true)
                            : undefined
                        }
                        onDecline={
                          planApproval
                            ? () => void respondToApproval(planApproval.request, false)
                            : undefined
                        }
                      />
                    ) : null}

                    {!isFinal ? (
                      <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                        <Spinner className="h-3 w-3" />
                        {pendingWrite
                          ? 'Waiting for your confirmation…'
                          : planApproval && !planApproval.resolved
                            ? 'Waiting for plan approval…'
                            : 'Working through the plan…'}
                      </div>
                    ) : message.plan ? (
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                        <CheckCircle2 className="h-3 w-3 text-mint" /> Plan completed
                      </p>
                    ) : null}

                    {message.approvals
                      ?.filter((approval) => approval.request.name !== 'plan-actions')
                      .filter((approval) => !approval.resolved)
                      .map((approval) => (
                        <ApprovalCard
                          key={approval.request.toolCallId}
                          approval={approval.request}
                          busy={approval.busy}
                          resolved={approval.resolved}
                          onApprove={() => void respondToApproval(approval.request, true)}
                          onDecline={(reason) =>
                            void respondToApproval(approval.request, false, reason)
                          }
                        />
                      ))}


                  </div>
                  {message.role === 'user' ? (
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink text-white">
                      <User className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {error ? (
          <div className="flex items-center justify-between gap-2 border-t border-line bg-rose-soft px-4 py-2 text-[12px] text-rose">
            <span className="min-w-0 flex-1">{error}</span>
            {messages.some((message) => message.role === 'user') ? (
              <button
                type="button"
                onClick={retry}
                disabled={streaming}
                className="shrink-0 font-medium underline underline-offset-2 disabled:opacity-50"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="border-t border-line px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
          <div className="flex items-end gap-2">
            <Input
              ref={composerRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask about invoices, or create a vendor, bill or customer invoice…"
              className="flex-1"
              disabled={streaming}
            />
            {streaming ? (
              <Button size="md" variant="secondary" onClick={stop} className="mb-0.5">
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
            ) : (
              <Button
                size="md"
                disabled={!input.trim()}
                onClick={() => void send(input)}
                className="mb-0.5"
              >
                <CornerDownLeft className="h-3.5 w-3.5" /> Send
              </Button>
            )}
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Minimal, safe markdown: paragraphs, bullets, fenced code, bold and inline code. */
function MarkdownText({ content }: { content: string }) {
  const parts = content.split(/```/);
  return (
    <div className="space-y-2">
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          const body = part.replace(/^[a-zA-Z0-9_-]*\n/, '');
          return (
            <pre
              key={index}
              className="overflow-auto rounded-lg bg-surface p-2 text-[11px] leading-relaxed text-muted scroll-thin"
            >
              {body.replace(/\n$/, '')}
            </pre>
          );
        }
        return part
          .split(/\n{2,}/)
          .filter((block) => block.trim().length > 0)
          .map((block, blockIndex) => {
            const lines = block.split('\n');
            const isList = lines.every((line) => /^\s*[-*]\s+/.test(line));
            if (isList) {
              return (
                <ul key={`${index}-${blockIndex}`} className="ml-4 list-disc space-y-0.5">
                  {lines.map((line, lineIndex) => (
                    <li key={lineIndex}>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ''))}</li>
                  ))}
                </ul>
              );
            }
            return <p key={`${index}-${blockIndex}`}>{inlineMarkdown(block)}</p>;
          });
      })}
    </div>
  );
}

function inlineMarkdown(text: string): ReactNode {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-surface px-1 py-0.5 font-num text-[12px]">
          {token.slice(1, -1)}
        </code>
      );
    }
    return token;
  });
}
