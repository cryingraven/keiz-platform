import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startMockOpenAi } from './mock-openai';

/**
 * Proves the Mastra path end to end without a NEAR AI key:
 * mock OpenAI-compatible model -> Mastra agent -> Mastra tool -> SSE -> memory.
 *
 * Run: pnpm --filter @keiz/api smoke:mastra
 */

const PORT = 3998;
const MOCK_PORT = 4123;
const BASE = `http://127.0.0.1:${PORT}/api`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'message';
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '{}';
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

async function main() {
  const mongo = await MongoMemoryServer.create();
  const mock = await startMockOpenAi(MOCK_PORT);

  process.env.MONGODB_URI = mongo.getUri('keiz_mastra_smoke');
  process.env.MONGODB_DB_NAME = 'keiz_mastra_smoke';
  process.env.JWT_SECRET = 'mastra-smoke-secret-0123456789abcdef';
  process.env.APP_DOMAIN = 'localhost';
  process.env.PAYMENTS_MODE = 'mock';
  process.env.AGENT_WALLET_MASTER_KEY = 'b'.repeat(64);
  process.env.CHAT_PROVIDER = 'mastra';
  process.env.NEARAI_API_KEY = 'test-key';
  process.env.NEAR_AI_BASE_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
  process.env.OUTLAYER_ENABLED = 'false';
  process.env.NODE_ENV = 'test';

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');
  const { UsersService } = await import('../src/users/users.service');

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  await app.listen(PORT);

  const users = app.get(UsersService);
  const jwt = app.get(JwtService);

  async function tokenFor(accountId: string) {
    const { user, org, membership } = await users.bootstrap(accountId);
    const token = await jwt.signAsync({
      sub: user.id,
      accountId,
      orgId: org!.id,
      role: membership!.role,
      type: 'access',
    });
    return `keiz_access=${token}`;
  }

  async function req<T>(
    path: string,
    options: { method?: string; body?: unknown; cookie?: string; expect?: number } = {},
  ): Promise<T> {
    const { method = 'GET', body, cookie, expect } = options;
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    const ok =
      expect === undefined
        ? response.status >= 200 && response.status < 300
        : response.status === expect;
    if (!ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
    return data as T;
  }

  async function approve(
    cookie: string,
    approval: { runId: string; threadId: string; toolCallId: string },
    approved = true,
  ): Promise<SseEvent[]> {
    const response = await fetch(`${BASE}/chat/approvals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ...approval, approved }),
    });
    assert(response.ok, `approval returned ${response.status}`);
    return parseSse(await response.text());
  }

  const pass = (label: string) => console.log(`  ok  ${label}`);

  try {
    console.log('\nKEIZ Mastra smoke test\n');

    const cookie = await tokenFor('mastra.near');

    const vendor = await req<{ _id: string }>('/vendors', {
      method: 'POST',
      cookie,
      body: {
        name: 'Mastra Vendor',
        email: 'billing@mastra.test',
        payoutChain: 'near',
        payoutAddress: 'mastravendor.near',
      },
    });
    const invoice = await req<{ _id: string }>('/invoices', {
      method: 'POST',
      cookie,
      body: {
        vendorId: vendor._id,
        number: 'INV-MASTRA-1',
        dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Agent integration', quantity: '1', unitPrice: '125.00' }],
      },
    });
    await req(`/invoices/${invoice._id}/submit`, { method: 'POST', cookie });
    await req(`/invoices/${invoice._id}/decision`, {
      method: 'POST',
      cookie,
      body: { decision: 'APPROVE' },
    });
    pass('fixture invoice created and approved');

    const response = await fetch(`${BASE}/chat/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: 'What invoices do we have?' }),
    });
    assert(response.ok, `chat returned ${response.status}`);
    assert(
      response.headers.get('content-type')?.includes('text/event-stream'),
      'content type is SSE',
    );
    const events = parseSse(await response.text());

    const meta = events.find((event) => event.event === 'meta');
    assert(meta?.data.provider === 'mastra', 'meta reports the mastra provider');
    pass('meta event reports the provider');

    const thread = events.find((event) => event.event === 'thread');
    assert(thread?.data.threadId, 'thread id emitted first');
    pass('SSE stream starts with a thread id');

    const plan = events.find((event) => event.event === 'plan')?.data.plan as
      | { goal: string }
      | undefined;
    assert(plan?.goal, 'action plan emitted before any tool runs');
    const planApproval = events.find((event) => event.event === 'approval')?.data
      .approval as
      | { runId: string; threadId: string; toolCallId: string; name: string }
      | undefined;
    assert(planApproval?.name === 'plan-actions', 'plan approval requested first');
    assert(
      events.some((event) => event.event === 'done' && event.data.suspended === true),
      'stream suspends for plan approval',
    );
    pass('Mastra suspends for the action plan');

    const afterPlan = await approve(cookie, planApproval!);
    assert(
      !afterPlan.some((event) => event.event === 'approval'),
      'read tool runs without another confirmation',
    );
    assert(
      afterPlan.some((event) => event.event === 'card' && (event.data.card as { kind?: string } | undefined)?.kind === 'plan'),
      'approved plan card emitted',
    );
    const toolResult = afterPlan.find(
      (event) =>
        event.event === 'tool' &&
        event.data.phase === 'result' &&
        event.data.name === 'listInvoices',
    );
    assert(toolResult, 'tool result emitted');
    assert(
      JSON.stringify(toolResult!.data.result).includes('INV-MASTRA-1'),
      'tool result is scoped to the caller org and contains the invoice',
    );
    assert(
      afterPlan.some(
        (event) => event.event === 'card' && (event.data.card as { kind?: string } | undefined)?.kind === 'invoice-list',
      ),
      'invoice list card emitted',
    );
    pass('read tool executed automatically after plan approval');

    const text = afterPlan
      .filter((event) => event.event === 'text')
      .map((event) => String(event.data.delta))
      .join('');
    assert(text.includes('invoices in the workspace'), `text assembled (got "${text}")`);
    pass('text deltas assemble into the final answer');

    assert(afterPlan.some((event) => event.event === 'done'), 'done event emitted');
    pass('stream terminates with done');

    assert(mock.requests.length >= 3, 'model was called again after each tool result');
    const second = mock.requests[1];
    const toolMessage = (second.messages ?? []).find((message) => message.role === 'tool');
    assert(toolMessage, 'tool result was sent back to the model');
    pass('tool result round-trips through the model');

    const threads = await req<Array<{ _id: string; title: string }>>('/chat/threads', {
      cookie,
    });
    assert(threads.length === 1, 'one thread stored in Mastra memory');
    assert(threads[0].title.includes('What invoices'), 'thread title comes from first message');
    pass('thread list comes from Mastra memory');

    const detail = await req<{
      messages: Array<{ role: string; content: string; toolCalls: unknown[] }>;
    }>(`/chat/threads/${threads[0]._id}`, { cookie });
    assert(detail.messages.length >= 2, 'user and assistant messages persisted');
    assert(
      detail.messages.some((message) => message.role === 'user'),
      'user message persisted',
    );
    assert(
      detail.messages.some(
        (message) =>
          message.role === 'assistant' && message.content.includes('invoices in the workspace'),
      ),
      'assistant message persisted',
    );
    pass('conversation history persists in Mastra memory');

    const otherCookie = await tokenFor('intruder.near');
    await req(`/chat/threads/${threads[0]._id}`, { cookie: otherCookie, expect: 404 });
    pass('another user cannot read the thread');

    console.log('\nMastra checks passed\n');
  } finally {
    await app.close();
    await mock.close();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error('\nMASTRA SMOKE FAILED\n', error);
  process.exit(1);
});
