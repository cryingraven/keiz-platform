import { describe, expect, it } from 'vitest';
import { createSseParser, SseFrame } from './sse';

function collect(chunks: string[]): SseFrame[] {
  const frames: SseFrame[] = [];
  const parser = createSseParser((frame) => frames.push(frame));
  for (const chunk of chunks) parser.push(chunk);
  parser.flush();
  return frames;
}

describe('SSE parser', () => {
  it('parses event and data fields', () => {
    const frames = collect(['event: text\ndata: {"delta":"hi"}\n\n']);
    expect(frames).toEqual([{ event: 'text', data: '{"delta":"hi"}' }]);
  });

  it('handles frames split across chunks', () => {
    const frames = collect(['event: te', 'xt\ndata: {"delta":', '"hi"}\n', '\n']);
    expect(frames).toEqual([{ event: 'text', data: '{"delta":"hi"}' }]);
  });

  it('handles CRLF', () => {
    const frames = collect(['event: done\r\ndata: {}\r\n\r\n']);
    expect(frames).toEqual([{ event: 'done', data: '{}' }]);
  });

  it('joins multiple data lines and ignores comments', () => {
    const frames = collect([': heartbeat\n\nevent: tool\ndata: line1\ndata: line2\n\n']);
    expect(frames).toEqual([{ event: 'tool', data: 'line1\nline2' }]);
  });

  it('emits multiple frames from one chunk', () => {
    const frames = collect(['event: a\ndata: 1\n\nevent: b\ndata: 2\n\n']);
    expect(frames.map((frame) => frame.event)).toEqual(['a', 'b']);
  });

  it('flushes a trailing frame without the final blank line', () => {
    const frames = collect(['event: done\ndata: {"ok":true}']);
    expect(frames).toEqual([{ event: 'done', data: '{"ok":true}' }]);
  });
});
