export interface SseFrame {
  event: string;
  data: string;
}

function parseBlock(block: string): SseFrame | null {
  const lines = block.split('\n');
  let event = 'message';
  const data: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

/**
 * Incremental text/event-stream parser.
 * Frames may be split across chunks, use CRLF, or contain comments/heartbeats.
 */
export function createSseParser(onFrame: (frame: SseFrame) => void) {
  let buffer = '';

  const drain = (flush: boolean) => {
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let index = buffer.indexOf('\n\n');
    while (index !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const frame = parseBlock(block);
      if (frame) onFrame(frame);
      index = buffer.indexOf('\n\n');
    }
    if (flush && buffer.trim()) {
      const frame = parseBlock(buffer);
      if (frame) onFrame(frame);
      buffer = '';
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      drain(false);
    },
    flush() {
      drain(true);
    },
  };
}
