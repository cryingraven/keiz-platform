import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { PaymentProviderFactory } from '../payments/payment-provider.factory';
import { WalletService } from './wallet.service';

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

function service(
  network: 'mainnet' | 'testnet' = 'mainnet',
  options?: {
    mode?: 'mock' | 'intents';
    tokens?: Array<{
      assetId: string;
      symbol: string;
      blockchain: string;
      decimals: number;
    }>;
  },
) {
  const values: Record<string, string> = {
    CHAIN_NETWORK: network,
    NEAR_RPC_URL: 'https://mainnet.test',
    NEAR_TESTNET_RPC_URL: 'https://testnet.test',
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  const provider = {
    mode: options?.mode ?? 'mock',
    getTokens: vi.fn(async () => options?.tokens ?? []),
  };
  const providerFactory = {
    get: () => provider,
  } as unknown as PaymentProviderFactory;
  return new WalletService(config, providerFactory);
}

function rpcResult(value: unknown) {
  return { result: { result: Array.from(Buffer.from(JSON.stringify(value))) } };
}

interface Body {
  params: Record<string, unknown> & {
    request_type?: string;
    method_name?: string;
    account_id?: string;
  };
}

function stubFetch(
  handler: (kind: 'index' | 'rpc', body: Body) => unknown,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('api.fastnear.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => handler('index', { params: {} }),
      } as Response;
    }
    const body = JSON.parse(String(init?.body)) as Body;
    return {
      ok: true,
      status: 200,
      json: async () => handler('rpc', body),
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WalletService.overview', () => {
  it('merges native NEAR, curated tokens and indexed NEP-141 tokens', async () => {
    stubFetch((kind, body) => {
      if (kind === 'index') {
        return {
          tokens: [
            { contract_id: 'wrap.near', balance: '5000000000000000000000000', last_update_block_height: 10 },
            { contract_id: USDC, balance: '2000000', last_update_block_height: 9 },
            { contract_id: 'token.near', balance: '4200000000', last_update_block_height: 8 },
            { contract_id: 'usdt.tether-token.near', balance: '0', last_update_block_height: 1 },
            { contract_id: 'NOT A CONTRACT', balance: '7' },
          ],
        };
      }
      const params = body.params;
      if (params.request_type === 'view_account') {
        return {
          result: {
            amount: '10000000000000000000000000',
            locked: '2000000000000000000000000',
            storage_usage: 1000,
          },
        };
      }
      if (params.method_name === 'ft_balance_of') {
        return rpcResult(
          params.account_id === 'wrap.near'
            ? '5000000000000000000000000'
            : params.account_id === USDC
              ? '2000000'
              : '0',
        );
      }
      if (params.method_name === 'ft_metadata') {
        return rpcResult({ symbol: 'TKN', name: 'Example Token', decimals: 8 });
      }
      return { result: {} };
    });

    const result = await service().overview('alice.near');

    expect(result.exists).toBe(true);
    expect(result.network).toBe('mainnet');
    expect(result.near.available).toBe('10000000000000000000000000');
    expect(result.near.staked).toBe('2000000000000000000000000');
    expect(result.near.total).toBe('12000000000000000000000000');
    expect(result.near.storageBytes).toBe(1000);
    expect(result.partial).toBe(false);

    const symbols = result.tokens.map((token) => token.symbol);
    expect(symbols).toEqual(['wNEAR', 'USDC', 'USDT', 'TKN']);
    expect(result.tokens[0].balance).toBe('5000000000000000000000000');
    expect(result.tokens[1].decimals).toBe(6);
    expect(result.tokens[3]).toMatchObject({
      contractId: 'token.near',
      decimals: 8,
      balance: '4200000000',
    });
  });

  it('returns zero balances for an account that does not exist yet', async () => {
    stubFetch((kind, body) => {
      expect(kind).toBe('rpc');
      expect(body.params.request_type).toBe('view_account');
      return {
        error: { cause: { name: 'UNKNOWN_ACCOUNT' }, message: 'account does not exist' },
      };
    });

    const result = await service().overview('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

    expect(result.exists).toBe(false);
    expect(result.near).toEqual({ total: '0', available: '0', staked: '0', storageBytes: 0 });
    expect(result.tokens).toEqual([]);
  });

  it('falls back to curated tokens when the index is unavailable', async () => {
    stubFetch((kind) => {
      if (kind === 'index') throw new Error('index offline');
      return { result: { amount: '1', locked: '0', storage_usage: 1 } };
    });

    const result = await service().overview('alice.near');

    expect(result.partial).toBe(true);
    expect(result.tokens.map((token) => token.symbol)).toEqual(['wNEAR', 'USDC', 'USDT']);
  });

  it('marks the result partial when token metadata cannot be read', async () => {
    stubFetch((kind, body) => {
      if (kind === 'index') {
        return { tokens: [{ contract_id: 'mystery.near', balance: '1' }] };
      }
      if (body.params.request_type === 'view_account') {
        return { result: { amount: '1', locked: '0', storage_usage: 1 } };
      }
      if (body.params.method_name === 'ft_metadata') {
        return { error: { message: 'Method not found' } };
      }
      return rpcResult('0');
    });

    const result = await service().overview('alice.near');

    expect(result.partial).toBe(true);
    expect(result.tokens.map((token) => token.symbol)).toEqual(['wNEAR', 'USDC', 'USDT']);
  });

  it('caches token metadata across refreshes', async () => {
    const fn = stubFetch((kind, body) => {
      if (kind === 'index') {
        return { tokens: [{ contract_id: 'token.near', balance: '1' }] };
      }
      if (body.params.request_type === 'view_account') {
        return { result: { amount: '1', locked: '0', storage_usage: 1 } };
      }
      if (body.params.method_name === 'ft_metadata') {
        return rpcResult({ symbol: 'TKN', name: 'Token', decimals: 2 });
      }
      return rpcResult('0');
    });

    const wallet = service();
    await wallet.overview('alice.near', true);
    await wallet.overview('alice.near', true);

    const metadataCalls = fn.mock.calls.filter(([, init]) => {
      if (!init?.body) return false;
      const body = JSON.parse(String(init.body)) as Body;
      return body.params?.method_name === 'ft_metadata';
    });
    expect(metadataCalls).toHaveLength(1);
  });

  it('reads the user NEAR Intents USDC balance on mainnet', async () => {
    const fn = stubFetch((kind, body) => {
      if (kind === 'index') return { tokens: [] };
      const params = body.params;
      if (params.request_type === 'view_account') {
        return { result: { amount: '1', locked: '0', storage_usage: 1 } };
      }
      if (params.method_name === 'mt_balance_of') return rpcResult('1234567');
      return rpcResult('0');
    });

    const result = await service().overview('alice.near');

    expect(result.intents).toEqual({
      tokenId: `nep141:${USDC}`,
      tokenContract: USDC,
      symbol: 'USDC',
      decimals: 6,
      balance: '1234567',
    });

    const intentsCall = fn.mock.calls.find(([, init]) => {
      if (!init?.body) return false;
      const body = JSON.parse(String(init.body)) as Body;
      return body.params?.method_name === 'mt_balance_of';
    });
    expect(intentsCall).toBeDefined();
    const body = JSON.parse(String(intentsCall?.[1]?.body)) as Body;
    expect(body.params.account_id).toBe('intents.near');
    const args = JSON.parse(
      Buffer.from(String(body.params.args_base64), 'base64').toString('utf8'),
    ) as { account_id: string; token_id: string };
    expect(args).toEqual({
      account_id: 'alice.near',
      token_id: `nep141:${USDC}`,
    });
  });

  it('keeps the wallet usable when the Intents balance cannot be read', async () => {
    stubFetch((kind, body) => {
      if (kind === 'index') return { tokens: [] };
      const params = body.params;
      if (params.request_type === 'view_account') {
        return { result: { amount: '1', locked: '0', storage_usage: 1 } };
      }
      if (params.method_name === 'mt_balance_of') {
        return { error: { message: 'contract call failed' } };
      }
      return rpcResult('0');
    });

    const result = await service().overview('alice.near');

    expect(result.intents).toBeNull();
    expect(result.tokens.map((token) => token.symbol)).toEqual(['wNEAR', 'USDC', 'USDT']);
  });

  it('uses the 1Click USDC token id in intents mode', async () => {
    const tokenId = `nep141:${USDC}`;
    const fn = stubFetch((kind, body) => {
      if (kind === 'index') return { tokens: [] };
      const params = body.params;
      if (params.request_type === 'view_account') {
        return { result: { amount: '1', locked: '0', storage_usage: 1 } };
      }
      return rpcResult('9');
    });

    const result = await service('mainnet', {
      mode: 'intents',
      tokens: [{ assetId: tokenId, symbol: 'USDC', blockchain: 'near', decimals: 6 }],
    }).overview('alice.near');

    expect(result.intents?.tokenId).toBe(tokenId);
    expect(result.intents?.balance).toBe('9');
    expect(fn).toHaveBeenCalled();
  });

  it('never calls the mainnet index or intents.near on testnet', async () => {
    const fn = stubFetch((_kind, body) => {
      if (body.params.request_type === 'view_account') {
        return { result: { amount: '1', locked: '0', storage_usage: 1 } };
      }
      return rpcResult('0');
    });

    const result = await service('testnet').overview('alice.testnet');

    expect(result.tokens.map((token) => token.symbol)).toEqual(['wNEAR']);
    expect(result.intents).toBeNull();
    expect(result.partial).toBe(false);
    expect(result.network).toBe('testnet');
    expect(String(fn.mock.calls[0][0])).toBe('https://testnet.test');
    expect(fn.mock.calls.some(([url]) => String(url).includes('fastnear'))).toBe(false);
    expect(
      fn.mock.calls.some(([, init]) => String(init?.body).includes('mt_balance_of')),
    ).toBe(false);
  });
});

describe('WalletService.recipient', () => {
  it('reports an unregistered token recipient with the required storage deposit', async () => {
    stubFetch((kind, body) => {
      expect(kind).toBe('rpc');
      if (body.params.request_type === 'view_account') {
        return { result: { amount: '1', locked: '0', storage_usage: 1 } };
      }
      if (body.params.method_name === 'storage_balance_of') return rpcResult(null);
      if (body.params.method_name === 'storage_balance_bounds') {
        return rpcResult({ min: '1250000000000000000000', max: '0' });
      }
      return { result: {} };
    });

    const result = await service().recipient('bob.near', USDC);

    expect(result).toEqual({
      accountId: 'bob.near',
      exists: true,
      contractId: USDC,
      registered: false,
      requiredStorageDeposit: '1250000000000000000000',
    });
  });

  it('reports a registered token recipient', async () => {
    stubFetch((kind, body) => {
      expect(kind).toBe('rpc');
      if (body.params.request_type === 'view_account') {
        return { result: { amount: '1', locked: '0', storage_usage: 1 } };
      }
      if (body.params.method_name === 'storage_balance_of') {
        return rpcResult({ total: '100', available: '100' });
      }
      return { result: {} };
    });

    const result = await service().recipient('bob.near', USDC);

    expect(result.registered).toBe(true);
    expect(result.requiredStorageDeposit).toBeNull();
  });

  it('rejects malformed account ids before touching RPC', async () => {
    const fn = stubFetch(() => {
      throw new Error('should not be called');
    });

    await expect(service().recipient('NOT A CONTRACT')).rejects.toThrow(/Invalid recipient/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('handles unknown recipients without an error', async () => {
    stubFetch((kind, body) => {
      expect(kind).toBe('rpc');
      if (body.params.request_type === 'view_account') {
        return {
          error: { cause: { name: 'UNKNOWN_ACCOUNT' }, message: 'account does not exist' },
        };
      }
      return { result: {} };
    });

    const result = await service().recipient('nobody.near');

    expect(result.exists).toBe(false);
    expect(result.registered).toBeNull();
  });
});
