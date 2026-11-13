import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseNearAccountId,
  type WalletIntentsBalance,
  type WalletNearBalance,
  type WalletOverview,
  type WalletRecipient,
  type WalletTokenBalance,
} from '@keiz/shared';
import { walletNetwork, type NearNetwork } from '../common/network';
import { fetchRpcWithRetry } from '../common/rpc-client';
import { PaymentProviderFactory } from '../payments/payment-provider.factory';

interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
}

interface CuratedToken extends TokenMetadata {
  contractId: string;
}

interface IndexedToken {
  contractId: string;
  balance: string;
  lastUpdate: number | null;
}

interface RpcErrorShape {
  cause?: { name?: string };
  message?: string;
}

const INDEX_URL = 'https://api.fastnear.com/v1/account';
const ACCOUNT_CACHE_MS = 15_000;
const METADATA_TTL_MS = 60 * 60 * 1000;
const BOUNDS_TTL_MS = 60 * 60 * 1000;
const MAX_TOKENS = 50;
const CONCURRENCY = 6;
const DEFAULT_STORAGE_DEPOSIT = '1250000000000000000000'; // 0.00125 NEAR

const INTENTS_CONTRACT_ID = 'intents.near';
const USDC_NEAR_CONTRACT = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const INTENTS_USDC_TOKEN_ID = `nep141:${USDC_NEAR_CONTRACT}`;

/**
 * The curated list guarantees the panel shows the tokens KEIZ settles with even
 * when the discovery index is unavailable. These are NEP-141 contract ids, not
 * 1Click asset ids.
 */
const CURATED_TOKENS: Record<NearNetwork, CuratedToken[]> = {
  mainnet: [
    {
      contractId: 'wrap.near',
      symbol: 'wNEAR',
      name: 'Wrapped NEAR',
      decimals: 24,
    },
    {
      contractId: USDC_NEAR_CONTRACT,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    {
      contractId: 'usdt.tether-token.near',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
    },
  ],
  testnet: [
    {
      contractId: 'wrap.testnet',
      symbol: 'wNEAR',
      name: 'Wrapped NEAR',
      decimals: 24,
    },
  ],
};

class NearQueryError extends Error {
  constructor(
    message: string,
    readonly unknownAccount = false,
  ) {
    super(message);
    this.name = 'NearQueryError';
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function asIntegerString(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
}

/** Bounded in-memory cache so a long-running API process cannot grow forever. */
function remember<T>(
  cache: Map<string, { at: number; value: T }>,
  key: string,
  value: T,
  maxEntries: number,
) {
  if (cache.size >= maxEntries) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

/**
 * Read-only view of the signed-in user's personal NEAR wallet.
 *
 * This service never signs, never moves funds and never touches the ledger.
 * Transfers are built in the browser and signed by the active signer (wallet or
 * passkey-derived key). `accountId` always comes from the JWT.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly metadataCache = new Map<string, { at: number; value: TokenMetadata }>();
  private readonly boundsCache = new Map<string, { at: number; value: string }>();
  private readonly overviewCache = new Map<string, { at: number; value: WalletOverview }>();

  constructor(
    private readonly config: ConfigService,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  private get network(): NearNetwork {
    return walletNetwork(this.config);
  }

  private get rpcUrl(): string {
    if (this.network === 'testnet') {
      return (
        this.config.get<string>('NEAR_TESTNET_RPC_URL') || 'https://rpc.testnet.near.org'
      );
    }
    return this.config.get<string>('NEAR_RPC_URL') || 'https://free.rpc.fastnear.com';
  }

  async overview(accountId: string, refresh = false): Promise<WalletOverview> {
    const account = parseNearAccountId(accountId);
    if (!account) throw new BadRequestException('Invalid NEAR account id');

    const network = this.network;
    const cacheKey = `${network}:${account}`;
    const cached = this.overviewCache.get(cacheKey);
    if (!refresh && cached && Date.now() - cached.at < ACCOUNT_CACHE_MS) {
      return cached.value;
    }

    const { exists, near } = await this.accountBalance(account);
    const [tokens, intents] = await Promise.all([
      exists ? this.tokenBalances(account, network) : Promise.resolve({ items: [], partial: false }),
      exists ? this.intentsBalance(account, network) : Promise.resolve(null),
    ]);

    const value: WalletOverview = {
      accountId: account,
      network,
      exists,
      near,
      tokens: tokens.items,
      intents,
      partial: tokens.partial,
      fetchedAt: new Date().toISOString(),
    };
    remember(this.overviewCache, cacheKey, value, 1_000);
    return value;
  }

  async recipient(accountId: string, contractId?: string): Promise<WalletRecipient> {
    const account = parseNearAccountId(accountId);
    if (!account) throw new BadRequestException('Invalid recipient account id');
    const contract = contractId ? parseNearAccountId(contractId) : null;
    if (contractId && !contract) throw new BadRequestException('Invalid token contract id');

    const balance = await this.viewAccount(account);
    if (!contract) {
      return {
        accountId: account,
        exists: balance !== null,
        contractId: null,
        registered: null,
        requiredStorageDeposit: null,
      };
    }

    let registered = false;
    let requiredStorageDeposit: string | null = null;
    try {
      const storage = await this.callFunction<{ total: string } | null>(
        contract,
        'storage_balance_of',
        { account_id: account },
      );
      registered = storage !== null && typeof storage === 'object';
      if (!registered) requiredStorageDeposit = await this.storageDeposit(contract);
    } catch (error) {
      // A contract that cannot answer storage_balance_of is treated as
      // unregistered; the UI then offers the deposit before the transfer.
      this.logger.debug(`storage_balance_of failed for ${contract}: ${(error as Error).message}`);
      requiredStorageDeposit = await this.storageDeposit(contract);
    }

    return {
      accountId: account,
      exists: balance !== null,
      contractId: contract,
      registered,
      requiredStorageDeposit,
    };
  }

  private async accountBalance(
    accountId: string,
  ): Promise<{ exists: boolean; near: WalletNearBalance }> {
    const result = await this.viewAccount(accountId);
    if (!result) {
      return {
        exists: false,
        near: { total: '0', available: '0', staked: '0', storageBytes: 0 },
      };
    }
    const amount = asIntegerString(result.amount) ?? '0';
    const locked = asIntegerString(result.locked) ?? '0';
    return {
      exists: true,
      near: {
        total: (BigInt(amount) + BigInt(locked)).toString(),
        available: amount,
        staked: locked,
        storageBytes: Number(result.storage_usage ?? 0),
      },
    };
  }

  private async viewAccount(accountId: string): Promise<{
    amount?: string;
    locked?: string;
    storage_usage?: number;
  } | null> {
    try {
      return await this.rpc(this.rpcUrl, 'query', {
        request_type: 'view_account',
        finality: 'final',
        account_id: accountId,
      });
    } catch (error) {
      if (error instanceof NearQueryError && error.unknownAccount) return null;
      throw new ServiceUnavailableException(
        `Could not read ${accountId} from NEAR: ${(error as Error).message}`,
      );
    }
  }

  private async tokenBalances(
    accountId: string,
    network: NearNetwork,
  ): Promise<{ items: WalletTokenBalance[]; partial: boolean }> {
    const curated = CURATED_TOKENS[network];
    let partial = false;

    const curatedRows = await mapLimit(curated, CONCURRENCY, async (token) => {
      const balance = await this.ftBalance(token.contractId, accountId);
      return this.tokenRow(token, balance);
    });

    const seen = new Set(curated.map((token) => token.contractId));
    const indexed = await this.discoverTokens(accountId, network);
    if (indexed === null) {
      if (network === 'mainnet') partial = true;
      return { items: curatedRows, partial };
    }

    const candidates = indexed.filter(
      (token) => token.balance !== '0' && !seen.has(token.contractId),
    );
    const discovered = candidates.slice(0, MAX_TOKENS);
    if (candidates.length > MAX_TOKENS) partial = true;

    const rows = await mapLimit(discovered, CONCURRENCY, async (token) => {
      const metadata = await this.tokenMetadata(token.contractId);
      if (!metadata) {
        partial = true;
        return null;
      }
      return this.tokenRow(metadata, token.balance);
    });

    return {
      items: [...curatedRows, ...rows.filter((row): row is WalletTokenBalance => row !== null)],
      partial,
    };
  }

  private tokenRow(token: TokenMetadata & { contractId: string }, balance: string) {
    const normalized = asIntegerString(balance) ?? '0';
    return {
      contractId: token.contractId,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      balance: normalized,
    } satisfies WalletTokenBalance;
  }

  /**
   * USDC held in the Verifier contract (`intents.near`), separate from the
   * user's on-chain NEP-141 balance. Mainnet only; a failed read must not take
   * down the rest of the wallet panel.
   */
  private async intentsBalance(
    accountId: string,
    network: NearNetwork,
  ): Promise<WalletIntentsBalance | null> {
    if (network !== 'mainnet') return null;
    const token = await this.intentsUsdcToken();
    try {
      const raw = await this.callFunction<string>(INTENTS_CONTRACT_ID, 'mt_balance_of', {
        account_id: accountId,
        token_id: token.tokenId,
      });
      return { ...token, balance: asIntegerString(raw) ?? '0' };
    } catch (error) {
      this.logger.debug(`mt_balance_of failed for ${accountId}: ${(error as Error).message}`);
      return null;
    }
  }

  private async intentsUsdcToken(): Promise<{
    tokenId: string;
    tokenContract: string;
    symbol: string;
    decimals: number;
  }> {
    // In intents mode the 1Click token list is the source of truth. The mock
    // provider's USDC is not a real contract, so it cannot be used here.
    if (this.providerFactory.get().mode === 'intents') {
      try {
        const tokens = await this.providerFactory.get().getTokens();
        const usdc = tokens.find(
          (token) =>
            token.blockchain.toLowerCase() === 'near' &&
            token.symbol.toUpperCase() === 'USDC' &&
            token.assetId.startsWith('nep141:'),
        );
        if (usdc) {
          return {
            tokenId: usdc.assetId,
            tokenContract: usdc.assetId.slice('nep141:'.length),
            symbol: 'USDC',
            decimals: usdc.decimals,
          };
        }
      } catch (error) {
        this.logger.debug(`Could not resolve Intents USDC: ${(error as Error).message}`);
      }
    }
    return {
      tokenId: INTENTS_USDC_TOKEN_ID,
      tokenContract: USDC_NEAR_CONTRACT,
      symbol: 'USDC',
      decimals: 6,
    };
  }

  private async discoverTokens(
    accountId: string,
    network: NearNetwork,
  ): Promise<IndexedToken[] | null> {
    if (network !== 'mainnet') return null;
    try {
      const response = await fetch(`${INDEX_URL}/${encodeURIComponent(accountId)}/ft`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        tokens?: Array<{
          contract_id?: unknown;
          balance?: unknown;
          last_update_block_height?: unknown;
        }>;
      };
      if (!Array.isArray(body.tokens)) return null;

      const tokens: IndexedToken[] = [];
      for (const raw of body.tokens) {
        const contractId =
          typeof raw.contract_id === 'string' ? parseNearAccountId(raw.contract_id) : null;
        const balance = asIntegerString(raw.balance);
        if (!contractId || !balance) continue;
        tokens.push({
          contractId,
          balance,
          lastUpdate:
            typeof raw.last_update_block_height === 'number'
              ? raw.last_update_block_height
              : null,
        });
      }
      // Highest recent activity first: this is a wallet panel, not a research tool.
      tokens.sort((a, b) => (b.lastUpdate ?? 0) - (a.lastUpdate ?? 0));
      return tokens;
    } catch (error) {
      this.logger.warn(`Token index unavailable: ${(error as Error).message}`);
      return null;
    }
  }

  private async ftBalance(contractId: string, accountId: string): Promise<string> {
    try {
      const result = await this.callFunction<string>(contractId, 'ft_balance_of', {
        account_id: accountId,
      });
      return asIntegerString(result) ?? '0';
    } catch {
      return '0';
    }
  }

  private async tokenMetadata(contractId: string): Promise<(TokenMetadata & { contractId: string }) | null> {
    const cached = this.metadataCache.get(contractId);
    if (cached && Date.now() - cached.at < METADATA_TTL_MS) {
      return { contractId, ...cached.value };
    }
    try {
      const raw = await this.callFunction<{
        symbol?: unknown;
        name?: unknown;
        decimals?: unknown;
      }>(contractId, 'ft_metadata', {});
      const symbol = typeof raw.symbol === 'string' ? raw.symbol.slice(0, 24).trim() : '';
      const name = typeof raw.name === 'string' ? raw.name.slice(0, 80).trim() : '';
      const decimals = typeof raw.decimals === 'number' ? raw.decimals : NaN;
      if (!symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
      const value = { symbol, name: name || symbol, decimals };
      remember(this.metadataCache, contractId, value, 5_000);
      return { contractId, ...value };
    } catch (error) {
      this.logger.debug(`ft_metadata failed for ${contractId}: ${(error as Error).message}`);
      return null;
    }
  }

  private async storageDeposit(contractId: string): Promise<string> {
    const cached = this.boundsCache.get(contractId);
    if (cached && Date.now() - cached.at < BOUNDS_TTL_MS) return cached.value;
    try {
      const bounds = await this.callFunction<{ min?: unknown }>(
        contractId,
        'storage_balance_bounds',
        {},
      );
      const min = asIntegerString(bounds?.min);
      if (min && min !== '0') {
        remember(this.boundsCache, contractId, min, 1_000);
        return min;
      }
    } catch (error) {
      this.logger.debug(`storage_balance_bounds failed for ${contractId}: ${(error as Error).message}`);
    }
    return DEFAULT_STORAGE_DEPOSIT;
  }

  private async callFunction<T>(
    contractId: string,
    methodName: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const result = await this.rpc<{ result?: number[] }>(this.rpcUrl, 'query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    });
    const bytes = Array.isArray(result.result) ? result.result : [];
    const text = Buffer.from(bytes).toString('utf8');
    return (text ? JSON.parse(text) : null) as T;
  }

  private async rpc<T>(
    url: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetchRpcWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'keiz-wallet', method, params }),
      },
      { timeoutMs: 15_000 },
    );
    const json = (await response.json()) as { result?: T; error?: RpcErrorShape };
    if (json.error) {
      const unknown =
        json.error.cause?.name === 'UNKNOWN_ACCOUNT' ||
        /does not exist/i.test(json.error.message ?? '');
      throw new NearQueryError(json.error.message ?? 'NEAR RPC query failed', unknown);
    }
    if (json.result === undefined) throw new NearQueryError('NEAR RPC returned no result');
    return json.result;
  }
}
