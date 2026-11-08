import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { auditNetworkConfig, parseNearNetwork, walletNetwork } from './network';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('network config', () => {
  it('prefers CHAIN_NETWORK over the frontend env and legacy value', () => {
    expect(
      walletNetwork(
        config({
          CHAIN_NETWORK: 'mainnet',
          NEXT_PUBLIC_CHAIN_NETWORK: 'testnet',
          NEAR_NETWORK: 'testnet',
        }),
      ),
    ).toBe('mainnet');
  });

  it('falls back to testnet for an unknown value', () => {
    expect(parseNearNetwork('nope')).toBe('testnet');
  });

  it('rejects intents mode on testnet', () => {
    expect(() =>
      auditNetworkConfig(
        config({
          CHAIN_NETWORK: 'testnet',
          NEAR_AUTH_NETWORK: 'testnet',
          PAYMENTS_MODE: 'intents',
        }),
      ),
    ).toThrow(/mainnet-only/);
  });

  it('rejects a passkey network that differs from the app network', () => {
    expect(() =>
      auditNetworkConfig(
        config({
          CHAIN_NETWORK: 'mainnet',
          NEAR_AUTH_NETWORK: 'testnet',
          PAYMENTS_MODE: 'mock',
        }),
      ),
    ).toThrow(/does not match/);
  });

  it('rejects a testnet fast-auth contract on mainnet', () => {
    expect(() =>
      auditNetworkConfig(
        config({
          CHAIN_NETWORK: 'mainnet',
          NEAR_AUTH_NETWORK: 'mainnet',
          NEAR_AUTH_CONTRACT_ID: 'fast-auth.testnet',
          PAYMENTS_MODE: 'mock',
        }),
      ),
    ).toThrow(/testnet contract/);
  });

  it('rejects an OutLayer host that disagrees with its network', () => {
    expect(() =>
      auditNetworkConfig(
        config({
          CHAIN_NETWORK: 'testnet',
          NEAR_AUTH_NETWORK: 'testnet',
          OUTLAYER_ENABLED: 'true',
          OUTLAYER_NETWORK: 'testnet',
          OUTLAYER_BASE_URL: 'https://api.outlayer.ai',
          PAYMENTS_MODE: 'mock',
        }),
      ),
    ).toThrow(/points at mainnet/);
  });

  it('accepts a coherent testnet setup and warns about a mainnet RPC', () => {
    const result = auditNetworkConfig(
      config({
        CHAIN_NETWORK: 'testnet',
        NEAR_AUTH_NETWORK: 'testnet',
        NEAR_AUTH_CONTRACT_ID: 'fast-auth.testnet',
        NEAR_RPC_URL: 'https://free.rpc.fastnear.com',
        PAYMENTS_MODE: 'mock',
      }),
    );
    expect(result.walletNetwork).toBe('testnet');
    expect(result.warnings.join(' ')).toMatch(/NEAR_RPC_URL/);
  });
});
