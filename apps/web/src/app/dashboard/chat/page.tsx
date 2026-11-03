'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  CornerDownLeft,
  Cpu,
  MessageSquarePlus,
  Sparkles,
  Square,
  User,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { api } from '@/lib/api';
import { shortAddress } from '@/lib/format';
import { streamChat } from '@/lib/chat-stream';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, Spinner, Textarea } from '@/components/ui';
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

export default function ChatPage() {
  const threads = useApi<Thread[]>('/chat/threads');
  const [threadId, setThreadId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

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

  async function loadThread(id: string) {
    try {
      const detail = await api<ThreadDetail>(`/chat/threads/${id}`);
      setThreadId(id);
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
      ? 'Local fallback · set NEARAI_API_KEY for Mastra + NEAR AI'
      : provider === 'mastra'
        ? `Mastra · ${modelId ?? 'NEAR AI Cloud'}`
        : 'Mastra agent · tools scoped to your workspace';

  return (
    <div>
      <PageHeader
        title="Assistant"
        description="A Mastra agent with tools scoped to your org. It cannot move funds."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              stop();
              setThreadId(undefined);
              setMessages([]);
                    }}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" /> New thread
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="hidden h-fit overflow-hidden lg:block">
          <div className="border-b border-line px-3.5 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted">Threads</p>
          </div>
          {threads.loading ? (
            <div className="px-3.5 py-4">
              <Spinner />
            </div>
          ) : (threads.data?.length ?? 0) === 0 ? (
            <p className="px-3.5 py-4 text-[11px] text-muted">No conversations yet.</p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto scroll-thin">
              {(threads.data ?? []).map((thread) => (
                <li key={thread._id}>
                  <button
                    onClick={() => void loadThread(thread._id)}
                    className={cn(
                      'w-full border-b border-line px-3.5 py-2.5 text-left transition hover:bg-paper',
                      threadId === thread._id && 'bg-paper',
                    )}
                  >
                    <p className="truncate text-[12px] font-medium">{thread.title}</p>
                    <p className="text-[10px] text-muted">
                      {new Date(thread.updatedAt).toLocaleDateString('en-US')}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex min-h-[560px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand">
                <Bot className="h-3.5 w-3.5" />
              </span>
              <div>
                <p className="text-[12px] font-semibold">KEIZ assistant</p>
                <p className="text-[10px] text-muted">{providerLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {streaming ? (
                <Badge className="border-brand/20 bg-brand-soft text-brand-deep" dot>
                  streaming
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 scroll-thin">
            {messages.length === 0 ? (
              <div className="mx-auto max-w-md py-8 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-paper">
                  <Sparkles className="h-5 w-5 text-brand" />
                </span>
                <p className="mt-3 text-sm font-semibold">Ask about your payables</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  The Mastra agent calls tools against your org. Payment requests become proposals
                  in the agent queue.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
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
                      'flex gap-3',
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
                        'max-w-[78%] rounded-2xl px-4 py-2.5',
                        message.role === 'user'
                          ? 'bg-ink text-white'
                          : 'border border-line bg-paper text-ink',
                      )}
                    >
                      {message.content ? (
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                          {message.content}
                          {streaming && isLast && message.role === 'assistant' ? (
                            <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-ink align-middle" />
                          ) : null}
                        </p>
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
            <div ref={endRef} />
          </div>

          {error ? (
            <p className="border-t border-line bg-rose-soft px-4 py-2 text-[11px] text-rose">
              {error}
            </p>
          ) : null}

          <div className="border-t border-line px-4 py-3">
            <div className="flex items-end gap-2">
              <Textarea
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
              Mastra streams tokens and tool calls over SSE. Chat can only create proposals.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
