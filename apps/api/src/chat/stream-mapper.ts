import { ChatStreamEvent } from './chat.types';

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Mastra wraps stream chunks as { type, from, payload }. Tests cover both the
 * wrapped and unwrapped shapes because field names have moved between minors.
 */
export function mapChunk(chunk: unknown): ChatStreamEvent | null {
  if (!chunk || typeof chunk !== 'object') return null;
  const record = chunk as Record<string, unknown>;
  const payload = (record.payload ?? {}) as Record<string, unknown>;
  const type = record.type;

  if (type === 'text-delta') {
    const delta =
      payload.text ?? payload.delta ?? record.text ?? record.delta ?? payload.textDelta;
    return typeof delta === 'string' && delta.length > 0 ? { type: 'text', delta } : null;
  }

  if (type === 'tool-call') {
    const name = payload.toolName ?? payload.name ?? record.toolName;
    const rawArgs = payload.args ?? payload.input ?? payload.toolInput ?? record.args ?? {};
    if (typeof name !== 'string' || !name) return null;
    const args =
      typeof rawArgs === 'string'
        ? (safeParse(rawArgs) as Record<string, unknown>)
        : (rawArgs as Record<string, unknown>);
    const toolCallId = payload.toolCallId ?? record.toolCallId;
    return {
      type: 'tool',
      phase: 'call',
      name,
      args: { ...args, ...(toolCallId ? { __toolCallId: String(toolCallId) } : {}) },
    };
  }

  if (type === 'tool-result') {
    const name = payload.toolName ?? payload.name ?? record.toolName;
    if (typeof name !== 'string' || !name) return null;
    return {
      type: 'tool',
      phase: 'result',
      name,
      result: payload.result ?? payload.output ?? payload.toolResult ?? record.result ?? null,
    };
  }

  if (type === 'error') {
    const error = (payload.error ?? record.error ?? {}) as Record<string, unknown>;
    const message = error.message ?? payload.message ?? record.message ?? 'Agent error';
    return { type: 'error', message: String(message) };
  }

  return null;
}
