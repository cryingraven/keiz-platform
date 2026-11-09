'use client';

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
  CheckCircle2,
  CornerDownLeft,
  Cpu,
  History,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { shortAddress } from '@/lib/format';
import { streamChat } from '@/lib/chat-stream';
import { Button, Spinner, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ChatStreamEvent } from '@keiz/shared';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'calling' | 'done' | 'error';
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
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

interface AssistantContextValue {
  open: boolean;
  openAssistant: () => void;
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
  const openAssistant = useCallback(() => setOpen(true), []);
  const closeAssistant = useCallback(() => setOpen(false), []);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <AssistantContext.Provider value={{ open, openAssistant, closeAssistant }}>
      {children}

      {!open ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={openAssistant}
          aria-label="Open assistant"
          aria-haspopup="dialog"
          aria-expanded="false"
          className="group fixed bottom-5 right-5 z-40 grid h-13 w-13 place-items-center rounded-full bg-ink text-white shadow-xl shadow-ink/25 ring-1 ring-white/10 transition hover:scale-105 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:bottom-6 sm:right-6"
        >
          <Bot className="h-5 w-5" />
          <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100 sm:block">
            Ask KEIZ
          </span>
        </button>
      ) : null}

      <AssistantDialog open={open} onClose={closeAssistant} />
    </AssistantContext.Provider>
  );
}

function AssistantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const threads = useApi<Thread[]>(open ? '/chat/threads' : null);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);

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
    if (!historyOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [historyOpen]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streaming, open]);

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
      return;
    }
    setMessages((current) => {
      if (current.length === 0) return current;
      const next = [...current];
      const index = next.length - 1;
      const last = next[index];
      if (last.role !== 'assistant') return current;

      if (event.type === 'text') {
        next[index] = { ...last, content: last.content + event.delta };
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
      { role: 'assistant', content: '', toolCalls: [] },
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
        if (last.role === 'assistant' && !last.content && (last.toolCalls?.length ?? 0) === 0) {
          next[next.length - 1] = { ...last, content: 'No response.' };
        }
        return next;
      });
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
    if (!window.confirm(`Delete "${thread.title}"?`)) return;
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
      setMessages(
        (detail.messages ?? []).map((message) => ({
          role: message.role,
          content: message.content,
          toolCalls: (message.toolCalls ?? []).map((call) => ({
            name: call.name,
            args: call.args,
            result: call.result,
            status: 'done' as const,
          })),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the thread');
    }
  }

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
              <h2 id="assistant-title" className="text-[13px] font-semibold">
                KEIZ assistant
              </h2>
              <p className="truncate text-[10px] text-muted">{providerLabel}</p>
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
            <div ref={historyRef} className="relative">
              <button
                type="button"
                onClick={() => setHistoryOpen((value) => !value)}
                aria-label="Conversation history"
                aria-expanded={historyOpen}
                aria-haspopup="menu"
                className="rounded-lg p-2 text-muted transition hover:bg-paper hover:text-ink"
              >
                <History className="h-4 w-4" />
              </button>
              {historyOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
                >
                  <div className="flex items-center justify-between border-b border-line px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted">Threads</p>
                    <button
                      type="button"
                      onClick={newThread}
                      className="flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
                    >
                      <MessageSquarePlus className="h-3 w-3" /> New
                    </button>
                  </div>
                  {threads.loading ? (
                    <div className="px-3 py-4">
                      <Spinner />
                    </div>
                  ) : (threads.data?.length ?? 0) === 0 ? (
                    <p className="px-3 py-4 text-[11px] text-muted">No conversations yet.</p>
                  ) : (
                    <ul className="max-h-64 overflow-y-auto scroll-thin">
                      {(threads.data ?? []).map((thread) => (
                        <li key={thread._id} className="flex items-stretch border-b border-line last:border-0">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => void loadThread(thread._id)}
                            className={cn(
                              'min-w-0 flex-1 px-3 py-2 text-left transition hover:bg-paper',
                              threadId === thread._id && 'bg-paper',
                            )}
                          >
                            <p className="truncate text-[12px] font-medium">{thread.title}</p>
                            <p className="text-[10px] text-muted">
                              {new Date(thread.updatedAt).toLocaleDateString('en-US')}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteThread(thread)}
                            aria-label={`Delete ${thread.title}`}
                            className="px-2 text-muted transition hover:bg-rose-soft hover:text-rose"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
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

        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-4 py-4 scroll-thin sm:px-5 sm:py-5"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {messages.length === 0 ? (
            <div className="mx-auto max-w-md py-6 text-center">
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-paper">
                <Sparkles className="h-5 w-5 text-brand" />
              </span>
              <p className="mt-3 text-sm font-semibold">Ask about your payables</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                The assistant calls tools against your org. Payment requests become proposals in
                the agent queue.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] text-muted transition hover:border-line-strong hover:text-ink"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => {
              const isLast = index === messages.length - 1;
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
                      <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
                        <MarkdownText content={message.content} />
                        {streaming && isLast && message.role === 'assistant' ? (
                          <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-ink align-middle" />
                        ) : null}
                      </div>
                    ) : streaming && isLast ? (
                      <span className="flex items-center gap-2 text-[12px] text-muted">
                        <Spinner className="h-3 w-3" /> thinking
                      </span>
                    ) : null}

                    {message.toolCalls && message.toolCalls.length > 0 ? (
                      <div className="mt-2 space-y-1.5 border-t border-line/70 pt-2">
                        {message.toolCalls.map((tool, toolIndex) => (
                          <details key={toolIndex} className="group">
                            <summary className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted">
                              {tool.status === 'calling' ? (
                                <Spinner className="h-3 w-3" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3 text-mint" />
                              )}
                              <span className="font-num text-ink">{tool.name}</span>
                              <span className="truncate text-muted/60">
                                {shortAddress(JSON.stringify(tool.args), 16)}
                              </span>
                            </summary>
                            <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-surface p-2 text-[9px] leading-relaxed text-muted scroll-thin">
                              {JSON.stringify(tool.result ?? tool.args, null, 2)}
                            </pre>
                          </details>
                        ))}
                      </div>
                    ) : null}
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
          <div className="flex items-center justify-between gap-2 border-t border-line bg-rose-soft px-4 py-2 text-[11px] text-rose">
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
            <Textarea
              ref={composerRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask about invoices, spend, or propose a payment…"
              className="min-h-[44px] max-h-32 flex-1 resize-none py-2.5"
              rows={1}
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
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted">
            <Cpu className="h-3 w-3" />
            Responses stream over SSE. Chat can only create proposals.
          </p>
        </div>
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
              className="overflow-auto rounded-lg bg-surface p-2 text-[10px] leading-relaxed text-muted scroll-thin"
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
        <code key={index} className="rounded bg-surface px-1 py-0.5 font-num text-[11px]">
          {token.slice(1, -1)}
        </code>
      );
    }
    return token;
  });
}
