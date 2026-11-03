import http from 'node:http';

interface ChatBody {
  model?: string;
  messages?: Array<{ role: string; content: unknown }>;
  tools?: Array<{ function?: { name?: string } }>;
}

/**
 * Minimal OpenAI-compatible streaming server.
 * First call: emit one tool call. After the tool result arrives: emit text.
 * This lets us test Mastra end to end without a NEAR AI key or network access.
 */
export async function startMockOpenAi(port: number) {
  const requests: ChatBody[] = [];
  let toolName = 'listInvoices';

  const server = http.createServer((req, res) => {
    if (!req.url?.includes('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = JSON.parse(raw) as ChatBody;
      requests.push(body);
      const hasToolResult = (body.messages ?? []).some((message) => message.role === 'tool');
      const declared = body.tools?.[0]?.function?.name;
      if (declared) toolName = declared;

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const id = `chatcmpl-${requests.length}`;
      const created = Math.floor(Date.now() / 1000);
      const base = {
        id,
        object: 'chat.completion.chunk',
        created,
        model: body.model ?? 'mock',
      };
      const send = (payload: unknown) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      if (!hasToolResult) {
        send({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: toolName, arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        send({
          ...base,
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] },
              finish_reason: null,
            },
          ],
        });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        send({
          ...base,
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'You have ' }, finish_reason: null },
          ],
        });
        send({
          ...base,
          choices: [{ index: 0, delta: { content: 'invoices in the workspace.' }, finish_reason: null }],
        });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      }

      send({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    server,
    requests,
    toolName: () => toolName,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
