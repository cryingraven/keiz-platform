import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutlayerClient } from '@outlayer/sdk';
import { outlayerNetwork } from '../common/network';

export interface OutlayerRegistration {
  walletId: string;
  apiKey: string;
  nearAccountId: string;
  publicKey: string;
  handoffUrl?: string;
}

export interface OutlayerToken {
  tokenId: string;
  symbol: string;
  decimals: number;
  chain: string;
}

export interface OutlayerWalletInfo {
  address: string;
  publicKey: string;
  nativeBalance: string;
  intentsUsdc: string;
  /** NEP-141 USDC held directly by the custody account. */
  onChainUsdc: string;
  frozen: boolean;
  policy: Record<string, unknown> | null;
  /** Non-fatal custody API failures; balances may be stale/zero when present. */
  errors?: string[];
}

type Chain =
  | 'near'
  | 'ethereum'
  | 'base'
  | 'arbitrum'
  | 'solana'
  | 'bsc'
  | 'polygon'
  | 'optimism'
  | 'avalanche'
  | 'bitcoin'
  | 'stellar'
  | 'tron'
  | 'ton';

const CHAIN_ALIASES: Record<string, string> = {
  eth: 'ethereum',
  arb: 'arbitrum',
  sol: 'solana',
};

@Injectable()
export class OutlayerService {
  private readonly logger = new Logger(OutlayerService.name);
  private readonly enabled: boolean;
  private readonly network: 'mainnet' | 'testnet';
  private readonly baseUrl: string;
  private tokenCache?: {
    at: number;
    tokens: Array<{
      id: string;
      symbol: string;
      decimals: number;
      chains: string[];
      defuse_asset_id?: string;
    }>;
  };

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<string>('OUTLAYER_ENABLED') === 'true';
    this.network = outlayerNetwork(config);
    // The SDK's built-in hosts are stale (api.*.outlayer.fastnear.com). Always
    // pass an explicit base URL; the documented API hosts are below.
    this.baseUrl =
      config.get<string>('OUTLAYER_BASE_URL') ||
      (this.network === 'mainnet'
        ? 'https://api.outlayer.ai'
        : 'https://testnet-api.outlayer.ai');

    if (this.enabled && this.network === 'testnet' && this.baseUrl === 'https://api.outlayer.ai') {
      throw new Error('OUTLAYER_NETWORK=testnet but OUTLAYER_BASE_URL points at mainnet.');
    }
    if (this.enabled && this.network === 'mainnet' && this.baseUrl.includes('testnet')) {
      throw new Error('OUTLAYER_NETWORK=mainnet but OUTLAYER_BASE_URL points at testnet.');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get networkName(): 'mainnet' | 'testnet' {
    return this.network;
  }

  private client(apiKey: string): OutlayerClient {
    return new OutlayerClient({ apiKey, network: this.network, baseUrl: this.baseUrl });
  }

  async register(): Promise<OutlayerRegistration> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('OutLayer custody is disabled');
    }
    const registered = await OutlayerClient.register({
      network: this.network,
      baseUrl: this.baseUrl,
    });
    if (!registered.api_key) {
      throw new ServiceUnavailableException('OutLayer did not return an API key');
    }
    const address = await this.client(registered.api_key).getAddress('near');
    return {
      walletId: registered.wallet_id,
      apiKey: registered.api_key,
      nearAccountId: address.address ?? registered.near_account_id,
      publicKey: address.public_key ?? '',
      handoffUrl: registered.handoff_url,
    };
  }

  async describe(apiKey: string): Promise<OutlayerWalletInfo> {
    const client = this.client(apiKey);
    const errors: string[] = [];
    const capture = (label: string, error: unknown) => {
      errors.push(`${label}: ${(error as Error).message}`);
      return null;
    };
    const [address, native, policy] = await Promise.all([
      client.getAddress('near').catch((error) => capture('address', error)),
      client.getBalance({ chain: 'near' }).catch((error) => capture('balance', error)),
      client.policy.get().catch((error) => capture('policy', error)),
    ]);

    let intentsUsdc = '0';
    let onChainUsdc = '0';
    try {
      const usdc = await this.resolveToken(apiKey, 'near', 'USDC');
      const usdcContract = usdc.tokenId.replace(/^nep141:/, '');
      const [intents, onchain] = await Promise.all([
        client
          .getBalance({
            chain: 'near',
            token: usdc.tokenId,
            source: 'intents',
          })
          .catch((error) => {
            capture('intentsBalance', error);
            return null;
          }),
        client
          .getBalance({ chain: 'near', token: usdcContract })
          .catch((error) => {
            capture('onchainBalance', error);
            return null;
          }),
      ]);
      intentsUsdc = intents?.balance ?? '0';
      onChainUsdc = onchain?.balance ?? '0';
    } catch (error) {
      capture('intentsBalance', error);
      // no Intents balance or token catalog unavailable
    }

    return {
      address: address?.address ?? '',
      publicKey: address?.public_key ?? '',
      nativeBalance: native?.balance ?? '0',
      intentsUsdc,
      onChainUsdc,
      frozen: Boolean((policy as { frozen?: boolean } | null)?.frozen),
      policy: (policy as Record<string, unknown> | null) ?? null,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async listTokens(apiKey: string) {
    if (this.tokenCache && Date.now() - this.tokenCache.at < 60 * 60 * 1000) {
      return this.tokenCache.tokens;
    }
    const response = await this.client(apiKey).listTokens();
    this.tokenCache = { at: Date.now(), tokens: response.tokens ?? [] };
    return this.tokenCache.tokens;
  }

  async resolveToken(apiKey: string, chain: string, symbol: string): Promise<OutlayerToken> {
    const normalized = CHAIN_ALIASES[chain] ?? chain;
    const tokens = await this.listTokens(apiKey);
    const match = tokens.find(
      (token) =>
        token.symbol.toUpperCase() === symbol.toUpperCase() &&
        token.chains.map((value) => value.toLowerCase()).includes(normalized),
    );
    const tokenId = match?.defuse_asset_id ?? match?.id;
    if (!match || !tokenId) {
      throw new ServiceUnavailableException(`OutLayer does not list ${symbol} on ${normalized}`);
    }
    return { tokenId, symbol: match.symbol, decimals: match.decimals, chain: normalized };
  }

  normalizeChain(chain: string): Chain {
    return (CHAIN_ALIASES[chain] ?? chain) as Chain;
  }

  async withdraw(
    apiKey: string,
    params: {
      chain: string;
      to: string;
      amount: string;
      token: string;
      idempotencyKey?: string;
    },
  ) {
    return this.client(apiKey).withdraw({
      chain: this.normalizeChain(params.chain) as never,
      to: params.to,
      amount: params.amount,
      token: params.token,
      idempotencyKey: params.idempotencyKey,
    });
  }

  async withdrawDryRun(
    apiKey: string,
    params: { chain: string; to: string; amount: string; token: string },
  ) {
    return this.client(apiKey).withdrawDryRun({
      chain: this.normalizeChain(params.chain) as never,
      to: params.to,
      amount: params.amount,
      token: params.token,
    });
  }

  async getBalance(
    apiKey: string,
    opts: { chain?: 'near'; token?: string; source?: 'chain' | 'intents' },
  ) {
    return this.client(apiKey).getBalance(opts);
  }

  async call(
    apiKey: string,
    params: {
      receiver_id: string;
      method_name: string;
      args?: Record<string, unknown>;
      args_base64?: string;
      gas?: string;
      deposit?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.client(apiKey).call(params);
  }

  async swapQuote(
    apiKey: string,
    params: {
      token_in: string;
      token_out: string;
      amount_in: string;
      min_amount_out?: string;
    },
  ) {
    return this.client(apiKey).swapQuote(params);
  }

  async swap(
    apiKey: string,
    params: {
      token_in: string;
      token_out: string;
      amount_in: string;
      min_amount_out?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.client(apiKey).swap(params);
  }

  async intentsDeposit(
    apiKey: string,
    params: { token: string; amount: string; idempotencyKey?: string },
  ) {
    return this.client(apiKey).intentsDeposit(params);
  }

  async getRequest(apiKey: string, requestId: string) {
    return this.client(apiKey).getRequest(requestId);
  }

  async policy(apiKey: string) {
    return this.client(apiKey).policy.get();
  }

  async approvals(apiKey: string) {
    return this.client(apiKey).approvals.listPending();
  }

  handoffUrl(apiKey: string): string {
    return `https://app.outlayer.ai/wallet?key=${encodeURIComponent(apiKey)}`;
  }
}
