import type {
  ChatApprovalRequest,
  ChatCard,
  ChatPlan,
  ChatStreamEvent,
} from '@keiz/shared';

export interface ChatRequestContext {
  orgId: string;
  userId: string;
  accountId: string;
  role: string;
  planApproved: boolean;
}

export type {
  ChatApprovalRequest,
  ChatCard,
  ChatPlan,
  ChatStreamEvent,
} from '@keiz/shared';
export { chatCardSchema } from '@keiz/shared';

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
