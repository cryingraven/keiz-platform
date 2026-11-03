export type ChatStreamEvent =
  | { type: 'meta'; provider: 'mastra' | 'local'; modelId: string }
  | { type: 'thread'; threadId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; phase: 'call'; name: string; args: Record<string, unknown> }
  | { type: 'tool'; phase: 'result'; name: string; result: unknown }
  | { type: 'done'; threadId: string; usage?: unknown }
  | { type: 'error'; message: string };
