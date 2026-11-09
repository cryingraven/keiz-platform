import type { ChatCard, ChatPlan, ChatRisk } from './chat-cards';

export type { ChatCard, ChatPlan, ChatPlanStep, ChatRisk } from './chat-cards';

export interface ChatApprovalRequest {
  runId: string;
  threadId: string;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  summary: string;
  risk: ChatRisk;
  planId?: string;
}

export type ChatStreamEvent =
  | { type: 'meta'; provider: 'mastra' | 'local'; modelId: string }
  | { type: 'thread'; threadId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; phase: 'call'; name: string; args: Record<string, unknown> }
  | { type: 'tool'; phase: 'result'; name: string; result: unknown }
  | { type: 'plan'; plan: ChatPlan }
  | { type: 'card'; card: ChatCard }
  | { type: 'approval'; approval: ChatApprovalRequest }
  | { type: 'approval_result'; toolCallId: string; approved: boolean; reason?: string }
  | { type: 'done'; threadId: string; usage?: unknown; suspended?: boolean }
  | { type: 'error'; message: string };
