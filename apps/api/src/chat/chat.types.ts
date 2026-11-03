import type { ChatStreamEvent } from '@keiz/shared';

export interface ChatRequestContext {
  orgId: string;
  userId: string;
  accountId: string;
}

export type { ChatStreamEvent } from '@keiz/shared';

export interface ChatMessageView {
  _id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
  at: string;
}

export interface ChatThreadView {
  _id: string;
  title: string;
  updatedAt: string;
}
