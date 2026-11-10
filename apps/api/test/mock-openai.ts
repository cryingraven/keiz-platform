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
      const toolResults = (body.messages ?? []).filter(
        (message) => message.role === 'tool',
      ).length;
      const hasToolResult = toolResults >= 2;
      const declared = body.tools?.[0]?.function?.name;
      if (declared) toolName = declared;
      const lastUser = [...(body.messages ?? [])]
        .reverse()
        .find((message) => message.role === 'user');
      const lastUserText =
        typeof lastUser?.content === 'string'
          ? lastUser.content
          : JSON.stringify(lastUser?.content ?? '');
      const createVendorFlow = lastUserText.toLowerCase().includes('create a vendor');

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
        const nextTool = createVendorFlow
          ? toolResults === 0
            ? 'plan-actions'
            : 'createVendor'
          : toolResults === 0
            ? 'plan-actions'
            : 'listInvoices';
        const args =
          createVendorFlow && toolResults > 0
            ? JSON.stringify({
                name: 'Mastra Vendor',
                email: 'pay@mastravendor.test',
                payoutChain: 'near',
                payoutAddress: 'mastravendor.near',
              })
            : toolResults === 0
              ? JSON.stringify({
                  goal: createVendorFlow ? 'Create a vendor' : 'Read the latest invoices',
                  summary: createVendorFlow ? 'One write step.' : 'One read-only step.',
                  steps: [
                    createVendorFlow
                      ? {
                          title: 'Create the vendor',
                          detail: 'Confirm the payout details before writing.',
                          tool: 'create-vendor',
                          risk: 'write',
                        }
                      : {
                          title: 'List invoices',
                          detail: 'Load the workspace bills.',
                          tool: 'list-invoices',
                          risk: 'read',
                        },
                  ],
                })
              : '{}';
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
                    id: `call_${toolResults + 1}`,
                    type: 'function',
                    function: { name: nextTool, arguments: '' },
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
              delta: {
                tool_calls: [{ index: 0, function: { arguments: args } }],
              },
              finish_reason: null,
            },
          ],
        });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        const finalText = createVendorFlow
          ? ['Created ', 'the vendor.']
          : ['You have ', 'invoices in the workspace.'];
        send({
          ...base,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: finalText[0] },
              finish_reason: null,
            },
          ],
        });
        send({
          ...base,
          choices: [
            { index: 0, delta: { content: finalText[1] }, finish_reason: null },
          ],
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
