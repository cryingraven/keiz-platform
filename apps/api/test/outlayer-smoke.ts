import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startMockOutlayer } from './mock-outlayer';

/**
 * OutLayer custody smoke test against a mock API.
 * Covers registration, wallet description, delegated policy, execution,
 * request polling, and invoice settlement. No real funds or TEE.
 */

const PORT = 3997;
const MOCK_PORT = 4124;
const BASE = `http://127.0.0.1:${PORT}/api`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  const mongo = await MongoMemoryServer.create();
  const mock = await startMockOutlayer(MOCK_PORT);

  process.env.MONGODB_URI = mongo.getUri('keiz_outlayer_smoke');
  process.env.MONGODB_DB_NAME = 'keiz_outlayer_smoke';
  process.env.JWT_SECRET = 'outlayer-smoke-secret-0123456789abcdef';
  process.env.APP_DOMAIN = 'localhost';
  process.env.PAYMENTS_MODE = 'mock';
  process.env.AGENT_WALLET_MASTER_KEY = 'c'.repeat(64);
  process.env.OUTLAYER_ENABLED = 'true';
  process.env.OUTLAYER_NETWORK = 'testnet';
  process.env.OUTLAYER_BASE_URL = `http://127.0.0.1:${MOCK_PORT}`;
  process.env.CHAT_PROVIDER = 'local';
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
    return { cookie: `keiz_access=${token}`, user, org };
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

  const pass = (label: string) => console.log(`  ok  ${label}`);

  try {
    console.log('\nKEIZ OutLayer custody smoke\n');
    const { cookie, org } = await tokenFor('custody.near');

    const wallet = await req<{
      provider: string;
      accountId: string;
      handoffUrl?: string | null;
      custody?: { nativeBalance: string; intentsUsdc: string };
    }>('/agent/wallet', { method: 'POST', cookie });
    assert(wallet.provider === 'outlayer', 'wallet uses OutLayer custody');
    assert(wallet.accountId === 'a'.repeat(64), 'custody account returned');
    assert(Boolean(wallet.handoffUrl), 'owner receives the handoff URL');
    pass('custody wallet registered and handoff exposed to OWNER');

    const described = await req<{
      custody: { nativeBalance: string; intentsUsdc: string; frozen: boolean };
    }>('/agent/wallet', { cookie });
    assert(described.custody?.intentsUsdc === '500000000', 'intents balance reported');
    assert(described.custody?.frozen === false, 'policy freeze state reported');
    pass('balances and policy state read from the custody API');

    const policyStatus = await req<unknown>('/agent/wallet/policy', {
      method: 'PATCH',
      cookie,
      body: {
        perTxLimitUsd: '500',
        dailyLimitUsd: '1500',
        approvalThresholdUsd: '250',
        allowedAssets: ['nep141:usdc.near'],
        active: true,
      },
      expect: 400,
    });
    assert(policyStatus, 'custody policy update is rejected');
    pass('local policy edits are rejected for custody wallets');

    const vendor = await req<{ _id: string }>('/vendors', {
      method: 'POST',
      cookie,
      body: {
        name: 'Custody Vendor',
        email: 'ap@custody.test',
        payoutChain: 'near',
        payoutAddress: 'nusantara.near',
      },
    });
    const invoice = await req<{ _id: string }>('/invoices', {
      method: 'POST',
      cookie,
      body: {
        vendorId: vendor._id,
        number: 'INV-CUSTODY-1',
        dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        currency: 'USD',
        taxBps: 0,
        lineItems: [{ description: 'Custody test', quantity: '1', unitPrice: '4200.00' }],
      },
    });
    await req(`/invoices/${invoice._id}/submit`, { method: 'POST', cookie });
    await req(`/invoices/${invoice._id}/decision`, {
      method: 'POST',
      cookie,
      body: { decision: 'APPROVE' },
    });

    const action = await req<{ _id: string; status: string }>('/agent/actions', {
      method: 'POST',
      cookie,
      body: { invoiceId: invoice._id, asset: 'nep141:usdc.near' },
    });
    assert(action.status === 'APPROVED', 'custody proposal delegates policy to OutLayer');
    pass('custody proposal is delegated, not blocked by local USD caps');

    const executed = await req<{
      action: { status: string; paymentId?: string };
      payment: { provider: string; status: string; amountOutFormatted?: string };
    }>(`/agent/actions/${action._id}/execute`, { method: 'POST', cookie });
    assert(executed.action.status === 'EXECUTED', 'action executed');
    assert(executed.payment.provider === 'outlayer', 'payment uses the custody provider');
    assert(executed.payment.status === 'PROCESSING', 'payment starts processing');
    assert(executed.payment.amountOutFormatted === '4200', 'stablecoin amount is the invoice total');
    pass('custody withdraw executed and recorded as a payment');

    console.log('  ...  waiting for the custody poller');
    await new Promise((resolve) => setTimeout(resolve, 12_000));

    const paid = await req<{ status: string; paidAt?: string }>(`/invoices/${invoice._id}`, {
      cookie,
    });
    assert(paid.status === 'PAID', `invoice settles (status ${paid.status})`);

    const payments = await req<Array<{ status: string; txHash?: string }>>(
      `/payments?invoiceId=${invoice._id}`,
      { cookie },
    );
    assert(payments[0]?.status === 'SUCCEEDED', 'payment reaches SUCCEEDED');
    assert(payments[0]?.txHash === 'mock-intent-hash', 'custody intent hash stored');
    pass('poller settles the invoice and stores the custody intent hash');

    const actions = await req<Array<{ status: string }>>('/agent/actions', { cookie });
    assert(actions[0]?.status === 'EXECUTED', 'action remains EXECUTED');
    pass('agent action reflects the settled custody payment');

    void org;
    console.log('\nOutLayer custody checks passed\n');
  } finally {
    await app.close();
    await mock.close();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error('\nOUTLAYER SMOKE FAILED\n', error);
  process.exit(1);
});
