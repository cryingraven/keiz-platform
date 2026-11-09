import type { ConfigService } from '@nestjs/config';

export type NearNetwork = 'mainnet' | 'testnet';
export type PaymentsMode = 'mock' | 'intents';

export function parseNearNetwork(
  value: string | undefined,
  fallback: NearNetwork = 'testnet',
): NearNetwork {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'mainnet' || normalized === 'testnet') return normalized;
  return fallback;
}

/**
 * The chain the app is deployed against. `CHAIN_NETWORK` is the server-side
 * source of truth; `NEXT_PUBLIC_CHAIN_NETWORK` is accepted so a single repo-root
 * .env keeps Next and Nest aligned. `NEAR_NETWORK` is a legacy fallback.
 */
export function walletNetwork(config: ConfigService): NearNetwork {
  return parseNearNetwork(
    config.get<string>('CHAIN_NETWORK') ||
      config.get<string>('NEXT_PUBLIC_CHAIN_NETWORK') ||
      config.get<string>('NEAR_NETWORK'),
    'testnet',
  );
}

export function outlayerNetwork(config: ConfigService): NearNetwork {
  return parseNearNetwork(config.get<string>('OUTLAYER_NETWORK'), 'testnet');
}

export function paymentsMode(config: ConfigService): PaymentsMode {
  const raw = (config.get<string>('PAYMENTS_MODE') || 'mock').trim().toLowerCase();
  if (raw === 'mock' || raw === 'intents') return raw;
  throw new Error(`Invalid PAYMENTS_MODE "${raw}". Use "mock" or "intents".`);
}

/** Best-effort network hint from an RPC hostname. */
export function rpcNetworkHint(url: string | undefined): NearNetwork | 'unknown' {
  const value = (url ?? '').toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('testnet')) return 'testnet';
  if (
    value.includes('mainnet') ||
    value.includes('free.rpc.fastnear.com') ||
    value.includes('rpc.near.org')
  ) {
    return 'mainnet';
  }
  return 'unknown';
}

export interface NetworkAudit {
  walletNetwork: NearNetwork;
  outlayerNetwork: NearNetwork;
  paymentsMode: PaymentsMode;
  warnings: string[];
}

/**
 * Fail closed on configurations that cannot work, and warn on risky ones.
 * This runs at API boot and again from /health.
 */
export function auditNetworkConfig(config: ConfigService): NetworkAudit {
  const wallet = walletNetwork(config);
  const outlayer = outlayerNetwork(config);
  const mode = paymentsMode(config);
  const nodeEnv = config.get<string>('NODE_ENV') || 'development';
  const production = nodeEnv === 'production';
  const warnings: string[] = [];
  const fail = (message: string): never => {
    throw new Error(`[network] ${message}`);
  };

  const rpcUrl = config.get<string>('NEAR_RPC_URL') || 'https://free.rpc.fastnear.com';

  if (mode === 'intents') {
    if (wallet !== 'mainnet') {
      fail('PAYMENTS_MODE=intents is mainnet-only, but the app network is testnet.');
    }
    if (rpcNetworkHint(rpcUrl) === 'testnet') {
      fail('PAYMENTS_MODE=intents requires NEAR_RPC_URL on mainnet.');
    }
    if (!production) {
      warnings.push('PAYMENTS_MODE=intents is active outside production: real funds can move.');
    }
  }

  const explicitChain = config.get<string>('CHAIN_NETWORK');
  const publicChain = config.get<string>('NEXT_PUBLIC_CHAIN_NETWORK');
  if (
    explicitChain &&
    publicChain &&
    parseNearNetwork(explicitChain) !== parseNearNetwork(publicChain)
  ) {
    fail('CHAIN_NETWORK and NEXT_PUBLIC_CHAIN_NETWORK disagree.');
  }

  if (rpcNetworkHint(rpcUrl) !== 'unknown' && rpcNetworkHint(rpcUrl) !== wallet) {
    const message = `NEAR_RPC_URL looks like ${rpcNetworkHint(rpcUrl)} but the app network is ${wallet}.`;
    if (production) fail(message);
    warnings.push(message);
  }

  if (config.get<string>('OUTLAYER_ENABLED') === 'true') {
    const baseUrl =
      config.get<string>('OUTLAYER_BASE_URL') ||
      (outlayer === 'mainnet' ? 'https://api.outlayer.ai' : 'https://testnet-api.outlayer.ai');
    if (outlayer === 'testnet' && baseUrl === 'https://api.outlayer.ai') {
      fail('OUTLAYER_NETWORK=testnet but OUTLAYER_BASE_URL points at mainnet.');
    }
    if (outlayer === 'mainnet' && baseUrl.includes('testnet')) {
      fail('OUTLAYER_NETWORK=mainnet but OUTLAYER_BASE_URL points at testnet.');
    }
    if (outlayer !== wallet) {
      warnings.push(
        `OutLayer is on ${outlayer} while the app network is ${wallet}; custody payouts will not match wallet login.`,
      );
    }
  }

  if (production) {
    const appDomain = config.get<string>('APP_DOMAIN') || 'localhost';
    if (appDomain === 'localhost' || !appDomain.includes('.')) {
      fail('APP_DOMAIN must be the public domain in production; localhost is not a valid NEP-413 recipient.');
    }
    const webOrigin = config.get<string>('WEB_ORIGIN') || 'http://localhost:3000';
    if (webOrigin.includes('localhost')) {
      warnings.push('WEB_ORIGIN still contains localhost in production.');
    }
    if (wallet === 'testnet') {
      warnings.push('NODE_ENV=production is running against NEAR testnet.');
    }
  } else if (wallet === 'mainnet') {
    warnings.push(
      'CHAIN_NETWORK=mainnet outside production: demo seeding and mock settlement routes remain enabled.',
    );
  }

  return {
    walletNetwork: wallet,
    outlayerNetwork: outlayer,
    paymentsMode: mode,
    warnings,
  };
}
