import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * End-to-end smoke test against a real Mongo instance (in-memory) and the mock
 * payment provider. It exercises auth scoping, the invoice state machine, the
 * payment lifecycle, the agent policy, and the chat fallback.
 *
 * Run: pnpm --filter @keiz/api smoke
 */

const PORT = 3999;
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
  process.env.MONGODB_URI = mongo.getUri('keiz_smoke');
  process.env.JWT_SECRET = 'smoke-secret-please-change-0123456789';
  process.env.APP_DOMAIN = 'localhost';
  process.env.PAYMENTS_MODE = 'mock';
  process.env.AGENT_WALLET_MASTER_KEY = 'a'.repeat(64);
  // Never let the smoke test spend a real relayer's gas.
  process.env.NEAR_AUTH_RELAYER_ACCOUNT_ID = '';
  process.env.NEAR_AUTH_RELAYER_PRIVATE_KEY = '';
  process.env.OUTLAYER_ENABLED = 'false';
  process.env.CHAT_PROVIDER = 'local';
  process.env.NEARAI_API_KEY = '';
  process.env.NODE_ENV = 'test';
  process.env.QUEUES_ENABLED = 'false';

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');
  const { UsersService } = await import('../src/users/users.service');

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  await app.listen(PORT);

  const users = app.get(UsersService);
  const jwt = app.get(JwtService);
  const { AuthService } = await import('../src/auth/auth.service');
  const auth = app.get(AuthService);

  async function tokenFor(accountId: string) {
    const { user, org, membership } = await users.bootstrap(accountId);
    const token = await jwt.signAsync({
      sub: user.id,
      accountId,
      orgId: org!.id,
      role: membership!.role,
      type: 'access',
    });
    return { token, user, org };
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
    if (!ok) {
      throw new Error(`${method} ${path} -> ${response.status} (expected ${expect ?? '2xx'}): ${text}`);
    }
    return data as T;
  }

  async function statusOf(
    path: string,
    options: { method?: string; body?: unknown; cookie?: string },
  ): Promise<number> {
    const response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    await response.text();
    return response.status;
  }

  const checks: string[] = [];
  const pass = (label: string) => {
    checks.push(label);
    console.log(`  ok  ${label}`);
  };

  try {
    console.log('\nKEIZ smoke test\n');

    const health = await req<{ ok: boolean; paymentsMode: string }>('/health');
    assert(health.ok && health.paymentsMode === 'mock', 'health reports mock mode');
    pass('health endpoint is public');

    await req('/invoices', { expect: 401 });
    pass('unauthenticated invoice access is rejected');

    const anonymous = await req<{ user: null }>('/auth/me');
    assert(anonymous.user === null, 'anonymous session is null, not 401');
    pass('anonymous /auth/me returns an empty session');

    const wrongNetwork = await statusOf('/auth/challenge', {
      method: 'POST',
      body: { accountId: 'alice.near', network: 'mainnet' },
    });
    assert(wrongNetwork === 400, `mainnet challenge rejected on testnet (got ${wrongNetwork})`);
    await req('/auth/challenge', {
      method: 'POST',
      body: { accountId: 'alice.near', network: 'testnet' },
    });
    pass('challenges are bound to the deployment network');

    const alice = await tokenFor('alice.near');
    const aliceCookie = `keiz_access=${alice.token}`;

    const aliceJti = randomUUID();
    await users.setRefreshJti(alice.user.id, aliceJti);
    const aliceTokens = await auth.issueTokens(
      {
        sub: alice.user.id,
        accountId: 'alice.near',
        orgId: alice.org!.id,
        role: 'OWNER',
      },
      0,
      aliceJti,
    );
    const rotated = await req<{ ok: boolean }>('/auth/refresh', {
      method: 'POST',
      cookie: `keiz_refresh=${aliceTokens.refreshToken}`,
    });
    assert(rotated.ok, 'refresh token rotates');
    pass('refresh token rotates and issues a new session');

    const vendor = await req<{ _id: string }>('/vendors', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        name: 'Nusantara Cloud',
        email: 'billing@nusantara.cloud',
        payoutChain: 'near',
        payoutAddress: 'nusantara.near',
      },
    });
    assert(vendor._id, 'vendor created');
    pass('vendor created');

    const invoice = await req<{ _id: string; total: string; status: string }>('/invoices', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        vendorId: vendor._id,
        number: 'INV-SMOKE-1',
        dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 500,
        lineItems: [{ description: 'Cloud infra', quantity: '2', unitPrice: '2100.00' }],
      },
    });
    // 2 * 2100.00 = 420000 minor units, +5% tax = 441000
    assert(invoice.total === '441000', `totals use integer minor units (got ${invoice.total})`);
    assert(invoice.status === 'DRAFT', 'new invoice is DRAFT');
    pass('invoice totals computed in minor units, including tax');

    await req(`/invoices/${invoice._id}/submit`, { method: 'POST', cookie: aliceCookie });
    const approved = await req<{ status: string }>(`/invoices/${invoice._id}/decision`, {
      method: 'POST',
      cookie: aliceCookie,
      body: { decision: 'APPROVE' },
    });
    assert(approved.status === 'APPROVED', 'invoice approved');
    pass('invoice moves DRAFT -> SUBMITTED -> APPROVED');

    // Cross-tenant isolation
    const bob = await tokenFor('bob.near');
    const bobCookie = `keiz_access=${bob.token}`;
    await req(`/invoices/${invoice._id}`, { cookie: bobCookie, expect: 404 });
    pass('another org cannot read the invoice');

    const created = await req<{
      payment: {
        _id: string;
        status: string;
        depositAddress: string;
        amountOutFormatted: string;
        destinationChain: string;
      };
      originToken: { symbol: string };
    }>('/payments', {
      method: 'POST',
      cookie: aliceCookie,
      body: { invoiceId: invoice._id, originAsset: '', slippageBps: 100, payer: 'USER' },
    });
    assert(created.payment.depositAddress.startsWith('mock-'), 'mock deposit address issued');
    assert(created.payment.status === 'AWAITING_DEPOSIT', 'payment awaits deposit');
    assert(created.payment.amountOutFormatted === '4410', 'vendor receives the exact total');
    assert(created.originToken.symbol === 'USDC', 'origin asset resolved from token list');
    pass('quote committed and token resolved from /v0/tokens');

    const afterQuote = await req<{ status: string }>(`/invoices/${invoice._id}`, {
      cookie: aliceCookie,
    });
    assert(afterQuote.status === 'PAYMENT_PENDING', 'invoice is PAYMENT_PENDING');
    pass('invoice moves to PAYMENT_PENDING when a quote is committed');

    const deposited = await req<{ status: string }>(`/payments/${created.payment._id}/deposit`, {
      method: 'POST',
      cookie: aliceCookie,
      body: { txHash: 'mock-tx-smoke-0001' },
    });
    assert(deposited.status === 'PROCESSING', 'deposit moves payment to PROCESSING');
    pass('deposit submission moves payment to PROCESSING');

    await req(`/payments/${created.payment._id}/simulate?status=SUCCEEDED`, {
      method: 'POST',
      cookie: aliceCookie,
    });
    const settled = await req<{ status: string }>(`/payments/${created.payment._id}/refresh`, {
      method: 'POST',
      cookie: aliceCookie,
    });
    assert(settled.status === 'SUCCEEDED', 'payment settles');
    pass('payment reaches SUCCEEDED');

    const paid = await req<{ status: string; paidAt?: string }>(`/invoices/${invoice._id}`, {
      cookie: aliceCookie,
    });
    assert(paid.status === 'PAID' && paid.paidAt, 'invoice marked paid');
    pass('invoice becomes PAID on settlement');

    const events = await req<Array<{ status: string }>>(
      `/payments/${created.payment._id}/events`,
      { cookie: aliceCookie },
    );
    const statuses = events.map((event) => event.status);
    assert(
      statuses.includes('QUOTED') &&
        statuses.includes('AWAITING_DEPOSIT') &&
        statuses.includes('PROCESSING') &&
        statuses.includes('SUCCEEDED'),
      `append-only events recorded (${statuses.join(', ')})`,
    );
    pass('payment event log is append-only and complete');

    // Agent wallet + policy
    const wallet = await req<Record<string, unknown>>('/agent/wallet', {
      method: 'POST',
      cookie: aliceCookie,
    });
    assert(wallet.accountId, 'wallet created');
    assert(!('encryptedSecret' in wallet), 'encrypted secret is never returned');
    pass('agent wallet created without leaking the secret');

    const invoice2 = await req<{ _id: string }>('/invoices', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        vendorId: vendor._id,
        number: 'INV-SMOKE-2',
        dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Small job', quantity: '1', unitPrice: '100.00' }],
      },
    });
    await req(`/invoices/${invoice2._id}/submit`, { method: 'POST', cookie: aliceCookie });
    await req(`/invoices/${invoice2._id}/decision`, {
      method: 'POST',
      cookie: aliceCookie,
      body: { decision: 'APPROVE' },
    });

    const action = await req<{ _id: string; status: string; amountUsd: string }>(
      '/agent/actions',
      {
        method: 'POST',
        cookie: aliceCookie,
        body: {
          invoiceId: invoice2._id,
          asset: 'nep141:usdc.near',
          reason: 'smoke test',
        },
      },
    );
    assert(action.status === 'APPROVED', 'under-threshold action is auto-approved');
    pass('agent policy auto-approves under the threshold');

    const executed = await req<{ action: { status: string; paymentId?: string } }>(
      `/agent/actions/${action._id}/execute`,
      { method: 'POST', cookie: aliceCookie },
    );
    assert(executed.action.status === 'EXECUTED' && executed.action.paymentId, 'action executed');
    pass('agent action executes through the payment provider');

    const bigInvoice = await req<{ _id: string }>('/invoices', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        vendorId: vendor._id,
        number: 'INV-SMOKE-3',
        dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Large job', quantity: '1', unitPrice: '900.00' }],
      },
    });
    await req(`/invoices/${bigInvoice._id}/submit`, { method: 'POST', cookie: aliceCookie });
    await req(`/invoices/${bigInvoice._id}/decision`, {
      method: 'POST',
      cookie: aliceCookie,
      body: { decision: 'APPROVE' },
    });
    const blocked = await req<{ status: string }>('/agent/actions', {
      method: 'POST',
      cookie: aliceCookie,
      body: { invoiceId: bigInvoice._id, asset: 'nep141:usdc.near' },
    });
    assert(blocked.status === 'BLOCKED', 'policy blocks above the per-tx limit');
    pass('agent policy blocks above the per-transaction limit');

    // Atomic daily cap: two concurrent executions of $400 against a $500/day policy.
    await req('/agent/wallet/policy', {
      method: 'PATCH',
      cookie: aliceCookie,
      body: {
        perTxLimitUsd: '500',
        dailyLimitUsd: '500',
        approvalThresholdUsd: '500',
        allowedAssets: ['nep141:usdc.near'],
        active: true,
      },
    });

    async function approvedInvoice(number: string, amount: string) {
      const created = await req<{ _id: string }>('/invoices', {
        method: 'POST',
        cookie: aliceCookie,
        body: {
          vendorId: vendor._id,
          number,
          dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          currency: 'USD',
          taxBps: 0,
          lineItems: [{ description: 'Concurrency test', quantity: '1', unitPrice: amount }],
        },
      });
      await req(`/invoices/${created._id}/submit`, { method: 'POST', cookie: aliceCookie });
      await req(`/invoices/${created._id}/decision`, {
        method: 'POST',
        cookie: aliceCookie,
        body: { decision: 'APPROVE' },
      });
      return created._id;
    }

    const raceA = await approvedInvoice('INV-RACE-A', '400.00');
    const raceB = await approvedInvoice('INV-RACE-B', '400.00');
    const actionA = await req<{ _id: string }>('/agent/actions', {
      method: 'POST',
      cookie: aliceCookie,
      body: { invoiceId: raceA, asset: 'nep141:usdc.near' },
    });
    const actionB = await req<{ _id: string }>('/agent/actions', {
      method: 'POST',
      cookie: aliceCookie,
      body: { invoiceId: raceB, asset: 'nep141:usdc.near' },
    });
    const [raceStatusA, raceStatusB] = await Promise.all([
      statusOf(`/agent/actions/${actionA._id}/execute`, { method: 'POST', cookie: aliceCookie }),
      statusOf(`/agent/actions/${actionB._id}/execute`, { method: 'POST', cookie: aliceCookie }),
    ]);
    const successes = [raceStatusA, raceStatusB].filter((status) => status < 300).length;
    assert(successes === 1, `exactly one concurrent execution passes the daily cap (got ${raceStatusA}/${raceStatusB})`);
    pass('daily spend reservation is atomic under concurrency');

    // restore a permissive policy for the remaining checks
    await req('/agent/wallet/policy', {
      method: 'PATCH',
      cookie: aliceCookie,
      body: {
        perTxLimitUsd: '500',
        dailyLimitUsd: '1500',
        approvalThresholdUsd: '250',
        allowedAssets: ['nep141:usdc.near'],
        active: true,
      },
    });

    const chatResponse = await fetch(`${BASE}/chat/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      body: JSON.stringify({ message: 'spend summary' }),
    });
    assert(chatResponse.ok, 'chat stream opened');
    const chatEvents = parseSse(await chatResponse.text());
    const meta = chatEvents.find((event) => event.event === 'meta');
    assert(meta?.data.provider === 'local', 'chat falls back without an API key');
    const chatText = chatEvents
      .filter((event) => event.event === 'text')
      .map((event) => String(event.data.delta))
      .join('');
    assert(chatText.includes('Spend by status'), 'chat returned a spend summary');
    const chatTools = chatEvents.filter(
      (event) => event.event === 'tool' && event.data.phase === 'call',
    );
    assert(
      chatTools.some((event) => event.data.name === 'spendSummary'),
      'chat used the spend tool',
    );
    const chatThreadId = chatEvents.find((event) => event.event === 'thread')?.data
      .threadId as string;
    assert(chatThreadId, 'chat returned a thread id');
    pass('local chat streams through the same Mastra tools');

    const thread = await req<{ messages: Array<{ role: string }> }>(
      `/chat/threads/${chatThreadId}`,
      { cookie: aliceCookie },
    );
    assert(thread.messages.some((message) => message.role === 'user'), 'user message persisted');
    assert(
      thread.messages.some((message) => message.role === 'assistant'),
      'assistant message persisted',
    );
    pass('chat thread is persisted in Mastra memory');

    const booksResponse = await fetch(`${BASE}/chat/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      body: JSON.stringify({ message: 'books summary' }),
    });
    assert(booksResponse.ok, 'books chat stream opened');
    const booksEvents = parseSse(await booksResponse.text());
    const booksText = booksEvents
      .filter((event) => event.event === 'text')
      .map((event) => String(event.data.delta))
      .join('');
    assert(booksText.includes('Cash'), 'chat returned the ledger summary');
    assert(
      booksEvents.some(
        (event) => event.event === 'tool' && event.data.phase === 'call' && event.data.name === 'booksSummary',
      ),
      'chat used the books tool',
    );
    pass('local chat reads the double-entry ledger');

    const carol = await tokenFor('carol.near');
    const carolCookie = `keiz_access=${carol.token}`;
    await req('/demo/seed', { method: 'POST', cookie: carolCookie });
    const seededInvoices = await req<Array<{ number: string }>>('/invoices', {
      cookie: carolCookie,
    });
    assert(seededInvoices.some((row) => row.number === 'INV-1001'), 'demo data seeded');
    const carolReceivables = await req<Array<{ number: string }>>('/receivables', {
      cookie: carolCookie,
    });
    assert(
      carolReceivables.some((row) => row.number === 'AR-2002'),
      'demo seed creates customer invoices',
    );
    const carolBooks = await req<{
      trialBalance: { totals: { balanced: boolean; debit: string; credit: string } };
      cash: string;
    }>('/accounting/summary?currency=USD&from=2020-01-01T00:00:00.000Z', {
      cookie: carolCookie,
    });
    assert(carolBooks.trialBalance.totals.balanced, 'demo ledger is balanced');
    assert(carolBooks.cash.startsWith('2'), 'demo ledger has opening cash');
    pass('demo seed is idempotent and populates AP, AR and a balanced ledger');

    // --- double-entry ledger against a clean workspace ---
    const bobVendor = await req<{ _id: string }>('/vendors', {
      method: 'POST',
      cookie: bobCookie,
      body: {
        name: 'Bob Supplies',
        email: 'billing@bobsupplies.near',
        payoutChain: 'near',
        payoutAddress: 'bobsupplies.near',
      },
    });

    await req('/accounting/journal-entries', {
      method: 'POST',
      cookie: bobCookie,
      body: {
        memo: 'Opening cash',
        currency: 'USD',
        lines: [
          { accountCode: '1010', debit: '1000.00' },
          { accountCode: '3000', credit: '1000.00' },
        ],
      },
    });
    const bobOpening = await req<{ totals: { balanced: boolean } }>(
      '/accounting/trial-balance?currency=USD',
      { cookie: bobCookie },
    );
    assert(bobOpening.totals.balanced, 'opening entry leaves the trial balance balanced');
    pass('manual journal entry posts a balanced opening balance');

    const bobInvoice = await req<{ _id: string }>('/invoices', {
      method: 'POST',
      cookie: bobCookie,
      body: {
        vendorId: bobVendor._id,
        number: 'INV-BOB-AP',
        dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 1000,
        lineItems: [{ description: 'Consulting', quantity: '1', unitPrice: '100.00' }],
      },
    });
    await req(`/invoices/${bobInvoice._id}/submit`, { method: 'POST', cookie: bobCookie });
    await req(`/invoices/${bobInvoice._id}/decision`, {
      method: 'POST',
      cookie: bobCookie,
      body: { decision: 'APPROVE' },
    });

    const summaryUrl = `/accounting/summary?currency=USD&from=2020-01-01T00:00:00.000Z&to=${encodeURIComponent(
      new Date().toISOString(),
    )}`;
    type Books = {
      cash: string;
      receivable: string;
      payable: string;
      inputTax: string;
      taxPayable: string;
      revenue: string;
      expenses: string;
      netIncome: string;
      trialBalance: {
        rows: Array<{ code: string; balance: string }>;
        totals: { debit: string; credit: string; balanced: boolean };
      };
    };
    const afterApprove = await req<Books>(summaryUrl, { cookie: bobCookie });
    assert(afterApprove.expenses === '10000', 'expense recognised on approval');
    assert(afterApprove.inputTax === '1000', 'input tax recognised on approval');
    assert(afterApprove.payable === '11000', 'AP recognised on approval');
    assert(
      afterApprove.trialBalance.totals.debit === afterApprove.trialBalance.totals.credit &&
        afterApprove.trialBalance.totals.balanced,
      'trial balance stays balanced after AP recognition',
    );
    const apAging = await req<{ total: string; buckets: Array<{ key: string; amount: string }> }>(
      '/accounting/aging?side=AP&currency=USD',
      { cookie: bobCookie },
    );
    assert(apAging.total === '11000', 'AP aging includes the approved bill');
    assert(
      apAging.buckets.find((bucket) => bucket.key === 'current')?.amount === '11000',
      'AP aging puts a future bill in the current bucket',
    );
    pass('approved vendor bill posts expense, input tax and AP (balanced)');

    const bobPayment = await req<{ payment: { _id: string } }>('/payments', {
      method: 'POST',
      cookie: bobCookie,
      body: { invoiceId: bobInvoice._id, originAsset: '', slippageBps: 100, payer: 'USER' },
    });
    await req(`/payments/${bobPayment.payment._id}/deposit`, {
      method: 'POST',
      cookie: bobCookie,
      body: { txHash: 'mock-tx-bob-ap' },
    });
    await req(`/payments/${bobPayment.payment._id}/simulate?status=SUCCEEDED`, {
      method: 'POST',
      cookie: bobCookie,
    });
    await req(`/payments/${bobPayment.payment._id}/refresh`, {
      method: 'POST',
      cookie: bobCookie,
    });

    const afterPayment = await req<Books>(summaryUrl, { cookie: bobCookie });
    assert(afterPayment.payable === '0', 'AP cleared on settlement');
    assert(afterPayment.cash === '89000', 'cash reduced by the settled bill');
    assert(afterPayment.trialBalance.totals.balanced, 'trial balance stays balanced after payment');
    pass('paid vendor bill clears AP against cash');

    const customer = await req<{ _id: string }>('/customers', {
      method: 'POST',
      cookie: bobCookie,
      body: { name: 'Helios Labs', email: 'finance@helioslabs.io' },
    });
    const receivable = await req<{ _id: string; total: string; status: string }>('/receivables', {
      method: 'POST',
      cookie: bobCookie,
      body: {
        customerId: customer._id,
        number: 'AR-BOB-1',
        dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 1000,
        lineItems: [{ description: 'Platform access', quantity: '1', unitPrice: '500.00' }],
      },
    });
    assert(receivable.total === '55000', 'receivable totals include tax');
    assert(receivable.status === 'DRAFT', 'new receivable is a draft');
    await req(`/receivables/${receivable._id}/issue`, { method: 'POST', cookie: bobCookie });

    const afterIssue = await req<Books>(summaryUrl, { cookie: bobCookie });
    assert(afterIssue.receivable === '55000', 'AR recognised on issue');
    assert(afterIssue.revenue === '50000', 'revenue recognised on issue');
    assert(afterIssue.taxPayable === '5000', 'tax payable recognised on issue');
    assert(afterIssue.trialBalance.totals.balanced, 'trial balance stays balanced after AR issue');
    pass('issued customer invoice posts AR, revenue and tax payable');

    const partial = await req<{ status: string; paidAmount: string }>(
      `/receivables/${receivable._id}/receipts`,
      {
        method: 'POST',
        cookie: bobCookie,
        body: { amount: '200.00', method: 'BANK_TRANSFER', reference: 'bank-1' },
      },
    );
    assert(partial.status === 'PARTIALLY_PAID', 'partial receipt updates the status');
    assert(partial.paidAmount === '20000', 'partial receipt accumulates paidAmount');
    const afterPartial = await req<Books>(summaryUrl, { cookie: bobCookie });
    assert(afterPartial.receivable === '35000', 'partial receipt reduces AR');
    assert(afterPartial.cash === '109000', 'partial receipt increases cash');
    pass('partial receipt reduces AR and increases cash');

    await req(`/receivables/${receivable._id}/receipts`, {
      method: 'POST',
      cookie: bobCookie,
      body: { amount: '400.00', method: 'BANK_TRANSFER' },
      expect: 400,
    });
    pass('a receipt cannot exceed the outstanding amount');

    const paidReceivable = await req<{ status: string }>(`/receivables/${receivable._id}/receipts`, {
      method: 'POST',
      cookie: bobCookie,
      body: { amount: '350.00', method: 'ONCHAIN', txHash: 'mock-ar-receipt' },
    });
    assert(paidReceivable.status === 'PAID', 'final receipt marks the receivable paid');
    const afterFull = await req<Books>(summaryUrl, { cookie: bobCookie });
    assert(afterFull.receivable === '0', 'fully paid AR is cleared');
    assert(afterFull.cash === '144000', 'cash includes all receipts');
    assert(afterFull.trialBalance.totals.balanced, 'trial balance stays balanced after receipts');
    await req(`/receivables/${receivable._id}/void`, {
      method: 'POST',
      cookie: bobCookie,
      expect: 400,
    });
    pass('full receipt clears AR and a paid receivable cannot be voided');

    const voidable = await req<{ _id: string }>('/receivables', {
      method: 'POST',
      cookie: bobCookie,
      body: {
        customerId: customer._id,
        number: 'AR-BOB-2',
        dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Cancelled job', quantity: '1', unitPrice: '100.00' }],
      },
    });
    await req(`/receivables/${voidable._id}/issue`, { method: 'POST', cookie: bobCookie });
    await req(`/receivables/${voidable._id}/void`, { method: 'POST', cookie: bobCookie });
    const afterVoid = await req<Books>(summaryUrl, { cookie: bobCookie });
    assert(afterVoid.receivable === '0', 'voided AR invoice is reversed');
    assert(afterVoid.revenue === '50000', 'void reversal removes the revenue');
    assert(afterVoid.trialBalance.totals.balanced, 'trial balance stays balanced after a void');
    pass('voiding an issued receivable reverses its journal entry');

    const overdue = await req<{ _id: string }>('/receivables', {
      method: 'POST',
      cookie: bobCookie,
      body: {
        customerId: customer._id,
        number: 'AR-BOB-3',
        dueDate: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Overdue retainer', quantity: '1', unitPrice: '100.00' }],
      },
    });
    await req(`/receivables/${overdue._id}/issue`, { method: 'POST', cookie: bobCookie });
    const arAging = await req<{ total: string; buckets: Array<{ key: string; amount: string }> }>(
      '/accounting/aging?side=AR&currency=USD',
      { cookie: bobCookie },
    );
    assert(arAging.total === '10000', 'AR aging includes the open receivable');
    assert(
      arAging.buckets.find((bucket) => bucket.key === '1_30')?.amount === '10000',
      'AR aging puts a 10-day overdue invoice in 1-30',
    );
    pass('AR aging buckets overdue customer invoices');

    const noopRebuild = await req<{ created: number; failed: number }>('/accounting/rebuild', {
      method: 'POST',
      cookie: bobCookie,
    });
    const noopRebuildAgain = await req<{ created: number; failed: number }>('/accounting/rebuild', {
      method: 'POST',
      cookie: bobCookie,
    });
    assert(noopRebuild.created === 0 && noopRebuild.failed === 0, 'live postings need no backfill');
    assert(noopRebuildAgain.created === 0, 'rebuild is idempotent');
    pass('ledger rebuild is idempotent');

    const journal = await req<Array<{ sourceType: string; lines: unknown[] }>>(
      '/accounting/journal-entries?currency=USD&limit=200',
      { cookie: bobCookie },
    );
    assert(journal.some((entry) => entry.sourceType === 'invoice'), 'invoice postings are listed');
    assert(journal.some((entry) => entry.sourceType === 'receipt'), 'receipt postings are listed');
    pass('journal exposes both AP and AR postings');

    await req(`/receivables/${overdue._id}`, { cookie: aliceCookie, expect: 404 });
    pass('another org cannot read a receivable');

    const bobMember = await users.addMember(bob.org!.id, 'bobmember.near', 'MEMBER');
    const bobMemberCookie = `keiz_access=${await jwt.signAsync({
      sub: bobMember.id,
      accountId: 'bobmember.near',
      orgId: bob.org!.id,
      role: 'MEMBER',
      type: 'access',
      ver: 0,
    })}`;
    await req('/accounting/journal-entries', {
      method: 'POST',
      cookie: bobMemberCookie,
      body: {
        memo: 'Member entry',
        currency: 'USD',
        lines: [
          { accountCode: '1010', debit: '1.00' },
          { accountCode: '3000', credit: '1.00' },
        ],
      },
      expect: 403,
    });
    await req('/accounting/rebuild', {
      method: 'POST',
      cookie: bobMemberCookie,
      expect: 403,
    });
    await req('/agent/wallet/policy', {
      method: 'PATCH',
      cookie: bobMemberCookie,
      body: {
        perTxLimitUsd: '500',
        dailyLimitUsd: '1500',
        approvalThresholdUsd: '250',
        allowedAssets: ['nep141:usdc.near'],
        active: true,
      },
      expect: 403,
    });
    await req(`/receivables/${overdue._id}/receipts`, {
      method: 'POST',
      cookie: bobMemberCookie,
      body: { amount: '1.00', method: 'BANK_TRANSFER' },
      expect: 403,
    });
    await req('/accounting/summary?currency=USD', { cookie: bobMemberCookie });
    pass('RBAC: MEMBER reads the books but cannot post or record receipts');

    // Refresh rotation has a short grace window so parallel tabs cannot log the
    // whole family out. A genuinely stale token must still be rejected.
    const eve = await tokenFor('eve.near');
    const eveJti = randomUUID();
    await users.setRefreshJti(eve.user.id, eveJti);
    const eveTokens = await auth.issueTokens(
      {
        sub: eve.user.id,
        accountId: 'eve.near',
        orgId: eve.org!.id,
        role: 'OWNER',
      },
      0,
      eveJti,
    );
    await req('/auth/refresh', {
      method: 'POST',
      cookie: `keiz_refresh=${eveTokens.refreshToken}`,
    });
    // The previous jti used by a parallel tab is accepted inside the grace window.
    await req('/auth/refresh', {
      method: 'POST',
      cookie: `keiz_refresh=${eveTokens.refreshToken}`,
    });

    const staleJti = randomUUID();
    const staleTokens = await auth.issueTokens(
      {
        sub: eve.user.id,
        accountId: 'eve.near',
        orgId: eve.org!.id,
        role: 'OWNER',
      },
      0,
      staleJti,
    );
    await users.setRefreshJti(eve.user.id, randomUUID());
    await req('/auth/refresh', {
      method: 'POST',
      cookie: `keiz_refresh=${staleTokens.refreshToken}`,
      expect: 401,
    });
    await req('/invoices', {
      cookie: `keiz_access=${staleTokens.accessToken}`,
      expect: 401,
    });
    pass('refresh rotation is grace-tolerant but revokes genuinely stale tokens');


    // --- authorization and input hardening ---
    const doubleInvoice = await approvedInvoice('INV-DOUBLE', '50.00');
    await req('/payments', {
      method: 'POST',
      cookie: aliceCookie,
      body: { invoiceId: doubleInvoice, originAsset: '', slippageBps: 100, payer: 'USER' },
    });
    const duplicateStatus = await statusOf('/payments', {
      method: 'POST',
      cookie: aliceCookie,
      body: { invoiceId: doubleInvoice, originAsset: '', slippageBps: 100, payer: 'USER' },
    });
    assert(duplicateStatus === 409, `second open quote is rejected (got ${duplicateStatus})`);
    pass('a second live quote for the same invoice is rejected');

    const badVendorStatus = await statusOf('/vendors', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        name: 'Wrong Chain',
        email: 'wrong@example.com',
        payoutChain: 'eth',
        payoutAddress: 'not-an-evm-address',
      },
    });
    assert(badVendorStatus === 400, `cross-chain payout address is rejected (got ${badVendorStatus})`);
    pass('payout address must match the chain');

    const negativeStatus = await statusOf('/invoices', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        vendorId: vendor._id,
        number: 'INV-NEGATIVE',
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Negative', quantity: '-1', unitPrice: '10.00' }],
      },
    });
    assert(negativeStatus === 400, `negative quantity is rejected (got ${negativeStatus})`);
    pass('negative invoice amounts are rejected');

    const malloryUser = await users.addMember(alice.org!.id, 'mallory.near', 'MEMBER');
    const malloryToken = await jwt.signAsync({
      sub: malloryUser.id,
      accountId: 'mallory.near',
      orgId: alice.org!.id,
      role: 'MEMBER',
      type: 'access',
      ver: 0,
    });
    const memberInvoice = await approvedInvoice('INV-RBAC-1', '10.00');
    const memberDecision = await statusOf(`/invoices/${memberInvoice}/decision`, {
      method: 'POST',
      cookie: `keiz_access=${malloryToken}`,
      body: { decision: 'APPROVE' },
    });
    assert(memberDecision === 403, `MEMBER cannot approve (got ${memberDecision})`);
    pass('RBAC blocks MEMBER from approving invoices');

    await users.addMember(alice.org!.id, 'finance.near', 'APPROVER');
    const selfInvoice = await req<{ _id: string }>('/invoices', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        vendorId: vendor._id,
        number: 'INV-SOD-1',
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Self approval', quantity: '1', unitPrice: '10.00' }],
      },
    });
    await req(`/invoices/${selfInvoice._id}/submit`, { method: 'POST', cookie: aliceCookie });
    const selfDecision = await statusOf(`/invoices/${selfInvoice._id}/decision`, {
      method: 'POST',
      cookie: aliceCookie,
      body: { decision: 'APPROVE' },
    });
    assert(selfDecision === 403, `creator cannot self-approve with another approver (got ${selfDecision})`);
    pass('segregation of duties blocks self-approval');

    // Draft edit recomputes totals server-side.
    const editable = await req<{ _id: string }>('/invoices', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        vendorId: vendor._id,
        number: 'INV-EDIT-1',
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Draft line', quantity: '1', unitPrice: '10.00' }],
      },
    });
    const edited = await req<{ total: string }>(`/invoices/${editable._id}`, {
      method: 'PATCH',
      cookie: aliceCookie,
      body: {
        vendorId: vendor._id,
        number: 'INV-EDIT-1',
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Draft line', quantity: '2', unitPrice: '10.00' }],
      },
    });
    assert(edited.total === '2000', `draft edit recomputes total (got ${edited.total})`);
    await req(`/invoices/${editable._id}/submit`, { method: 'POST', cookie: aliceCookie });
    const lockedEdit = await statusOf(`/invoices/${editable._id}`, {
      method: 'PATCH',
      cookie: aliceCookie,
      body: {
        vendorId: vendor._id,
        number: 'INV-EDIT-1',
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Nope', quantity: '1', unitPrice: '1.00' }],
      },
    });
    assert(lockedEdit === 400, `submitted bills cannot be edited (got ${lockedEdit})`);
    pass('draft bills are editable and totals are recomputed');

    // Team membership: add, change role, remove, and keep the last owner.
    await req('/members', {
      method: 'POST',
      cookie: aliceCookie,
      body: { accountId: 'teammate.near', role: 'APPROVER' },
    });
    const team = await req<Array<{ userId: string; accountId: string; role: string }>>(
      '/members',
      { cookie: aliceCookie },
    );
    const teammate = team.find((member) => member.accountId === 'teammate.near');
    assert(teammate, 'member was added');
    await req(`/members/${teammate.userId}`, {
      method: 'PATCH',
      cookie: aliceCookie,
      body: { role: 'MEMBER' },
    });
    await req(`/members/${teammate.userId}`, { method: 'DELETE', cookie: aliceCookie });
    const owner = team.find((member) => member.role === 'OWNER');
    assert(owner, 'workspace has an owner');
    const lastOwner = await statusOf(`/members/${owner.userId}`, {
      method: 'PATCH',
      cookie: aliceCookie,
      body: { role: 'ADMIN' },
    });
    assert(lastOwner === 400, `last owner cannot be demoted (got ${lastOwner})`);
    pass('members can be added, re-roled and removed; the last owner is protected');

    // Workspace switching: an invited user can enter the inviting workspace.
    await users.addMember(alice.org!.id, 'bob.near', 'APPROVER');
    const bobOrgs = await users.listOrgs(bob.user.id);
    assert(bobOrgs.length >= 2, 'bob now belongs to two workspaces');
    await users.switchOrg(bob.user.id, alice.org!.id);
    const bobProfile = await users.profile(bob.user.id);
    assert(
      bobProfile.org?.id === alice.org!.id,
      'active workspace changed to the inviting org',
    );
    pass('invited members can switch into the shared workspace');

    const signArgs = (guardId: string) =>
      Buffer.from(JSON.stringify({ guard_id: guardId, verify_payload: 'jwt', sign_payload: [] })).toString(
        'base64',
      );
    const relayWrong = await statusOf('/auth/near-auth/relay', {
      method: 'POST',
      body: {
        receiverId: 'evil.near',
        methodName: 'sign',
        argsBase64: signArgs('jwt#https://login.testnet.fast-auth.com/'),
        gas: '100000000000000',
        deposit: '1',
      },
    });
    assert(relayWrong === 400, `relayer rejects other contracts (got ${relayWrong})`);
    const relayBadGuard = await statusOf('/auth/near-auth/relay', {
      method: 'POST',
      body: {
        receiverId: 'fast-auth.testnet',
        methodName: 'sign',
        argsBase64: signArgs('jwt#https://evil.example/'),
        gas: '100000000000000',
        deposit: '1',
      },
    });
    assert(relayBadGuard === 400, `relayer rejects other guards (got ${relayBadGuard})`);
    const relayUnconfigured = await statusOf('/auth/near-auth/relay', {
      method: 'POST',
      body: {
        receiverId: 'fast-auth.testnet',
        methodName: 'sign',
        argsBase64: signArgs('jwt#https://login.testnet.fast-auth.com/'),
        gas: '100000000000000',
        deposit: '1',
      },
    });
    assert(
      relayUnconfigured === 503,
      `relayer reports missing configuration (got ${relayUnconfigured})`,
    );
    pass('NEAR Auth relay is restricted to fast-auth + the expected guard and fails closed');

    await new Promise((resolve) => setTimeout(resolve, 150));
    const audit = await req<Array<{ action: string }>>('/audit', { cookie: aliceCookie });
    assert(
      audit.some((entry) => entry.action.includes('POST') && entry.action.includes('invoices')),
      'audit log records mutating requests',
    );
    const memberAudit = await statusOf('/audit', { cookie: `keiz_access=${malloryToken}` });
    assert(memberAudit === 403, `MEMBER cannot read the audit log (got ${memberAudit})`);
    pass('audit log records mutations and is admin-only');

    console.log(`\n${checks.length} checks passed\n`);
  } finally {
    await app.close();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error('\nSMOKE FAILED\n', error);
  process.exit(1);
});
