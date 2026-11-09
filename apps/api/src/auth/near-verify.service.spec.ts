import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { NearVerifyService } from './near-verify.service';

const keyPair = nacl.sign.keyPair();
const publicKey = `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`;
const implicitAccount = Buffer.from(keyPair.publicKey).toString('hex');

function service() {
  const config = {
    get: (key: string) => {
      if (key === 'NEAR_RPC_URL') return 'https://mainnet.test';
      if (key === 'NEAR_AUTH_RPC_URL') return 'https://testnet.test';
      return undefined;
    },
  } as unknown as ConfigService;
  return new NearVerifyService(config);
}

function mockRpc(handlers: {
  account?: (params: Record<string, unknown>) => unknown;
  key?: (params: Record<string, unknown>) => unknown;
}) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      method: string;
      params: Record<string, unknown>;
    };
    const payload =
      body.params.request_type === 'view_account'
        ? handlers.account?.(body.params)
        : handlers.key?.(body.params);
    return { json: async () => payload } as Response;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NearVerifyService', () => {
  it('accepts a brand-new implicit account that matches the public key', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpc({
        account: () => ({
          error: { cause: { name: 'UNKNOWN_ACCOUNT' }, message: 'account does not exist' },
        }),
      }),
    );
    await expect(
      service().assertFullAccessKey(implicitAccount, publicKey, 'testnet'),
    ).resolves.toBeUndefined();
  });

  it('rejects a missing named account', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpc({
        account: () => ({
          error: { cause: { name: 'UNKNOWN_ACCOUNT' }, message: 'account does not exist' },
        }),
      }),
    );
    await expect(service().assertFullAccessKey('alice.near', publicKey, 'testnet')).rejects.toThrow(
      /does not exist/,
    );
  });

  it('requires a full-access key on an existing account', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpc({
        account: () => ({ result: { amount: '1' } }),
        key: () => ({ result: { permission: 'FullAccess' } }),
      }),
    );
    await expect(
      service().assertFullAccessKey('alice.near', publicKey, 'mainnet'),
    ).resolves.toBeUndefined();
  });

  it('rejects function-call keys', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpc({
        account: () => ({ result: { amount: '1' } }),
        key: () => ({ result: { permission: { FunctionCall: {} } } }),
      }),
    );
    await expect(service().assertFullAccessKey('alice.near', publicKey, 'mainnet')).rejects.toThrow(
      /full-access/,
    );
  });

  it('uses NEAR_AUTH_RPC_URL for testnet challenges', async () => {
    const fetchMock = mockRpc({
      account: () => ({ result: { amount: '1' } }),
      key: () => ({ result: { permission: 'FullAccess' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await service().assertFullAccessKey('alice.testnet', publicKey, 'testnet');
    expect(fetchMock.mock.calls[0][0]).toBe('https://testnet.test');
  });
});
