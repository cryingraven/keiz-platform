import { describe, expect, it } from 'vitest';
import { mapChunk } from './stream-mapper';

describe('mapChunk', () => {
  it('maps wrapped Mastra text deltas', () => {
    expect(mapChunk({ type: 'text-delta', payload: { text: 'hello' } })).toEqual({
      type: 'text',
      delta: 'hello',
    });
  });

  it('maps unwrapped AI SDK text deltas', () => {
    expect(mapChunk({ type: 'text-delta', text: 'hi' })).toEqual({ type: 'text', delta: 'hi' });
  });

  it('maps tool calls and keeps the tool call id', () => {
    expect(
      mapChunk({
        type: 'tool-call',
        payload: { toolName: 'listInvoices', args: { limit: 5 }, toolCallId: 'call_1' },
      }),
    ).toEqual({
      type: 'tool',
      phase: 'call',
      name: 'listInvoices',
      args: { limit: 5, __toolCallId: 'call_1' },
    });
  });

  it('parses stringified tool arguments', () => {
    const event = mapChunk({
      type: 'tool-call',
      payload: { toolName: 'getInvoice', args: '{"number":"INV-1"}' },
    });
    expect(event).toMatchObject({ phase: 'call', args: { number: 'INV-1' } });
  });

  it('maps tool results', () => {
    expect(
      mapChunk({ type: 'tool-result', payload: { toolName: 'spendSummary', result: { total: 1 } } }),
    ).toEqual({ type: 'tool', phase: 'result', name: 'spendSummary', result: { total: 1 } });
  });

  it('ignores irrelevant chunks and empty deltas', () => {
    expect(mapChunk({ type: 'start' })).toBeNull();
    expect(mapChunk({ type: 'text-delta', payload: { text: '' } })).toBeNull();
    expect(mapChunk(null)).toBeNull();
  });

  it('surfaces errors', () => {
    expect(mapChunk({ type: 'error', payload: { error: { message: 'boom' } } })).toEqual({
      type: 'error',
      message: 'boom',
    });
  });
});
