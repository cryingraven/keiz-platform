'use client';

import {
  createSseParser,
  type ChatApprovalRequest,
  type ChatStreamEvent,
} from '@keiz/shared';

export interface StreamChatOptions {
  message: string;
  threadId?: string;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

async function streamResponse(
  response: Response,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Chat request failed (${response.status})`);
  }
  if (!response.body) throw new Error('Streaming is not supported in this browser');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser((frame) => {
    try {
      onEvent(JSON.parse(frame.data) as ChatStreamEvent);
    } catch {
      // ignore malformed frame
    }
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
}

export async function streamChat({
  message,
  threadId,
  signal,
  onEvent,
}: StreamChatOptions): Promise<void> {
  const response = await fetch('/api/chat/messages', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, threadId }),
    signal,
  });
  await streamResponse(response, onEvent);
}

export interface StreamApprovalOptions {
  approval: Pick<ChatApprovalRequest, 'runId' | 'threadId' | 'toolCallId'>;
  approved: boolean;
  reason?: string;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

export async function streamChatApproval({
  approval,
  approved,
  reason,
  signal,
  onEvent,
}: StreamApprovalOptions): Promise<void> {
  const response = await fetch('/api/chat/approvals', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: approval.runId,
      threadId: approval.threadId,
      toolCallId: approval.toolCallId,
      approved,
      reason,
    }),
    signal,
  });
  await streamResponse(response, onEvent);
}

export async function fetchPendingApprovals(
  threadId: string,
): Promise<ChatApprovalRequest[]> {
  const response = await fetch(
    `/api/chat/approvals?threadId=${encodeURIComponent(threadId)}`,
    { credentials: 'include' },
  );
  if (!response.ok) return [];
  return (await response.json()) as ChatApprovalRequest[];
}
