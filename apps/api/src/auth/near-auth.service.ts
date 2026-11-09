import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authNetwork, rpcNetworkHint } from '../common/network';
import { NearAuthRelayer, NearRelayError, SignActionInput } from './near-tx';
import { QueueProducer } from '../queues/queue-producer.service';

interface QuotaWindow {
  day: string;
  total: number;
  perUser: Map<string, number>;
}

@Injectable()
export class NearAuthService {
  private readonly logger = new Logger(NearAuthService.name);
  private readonly relayer: NearAuthRelayer;
  private readonly dailyLimit: number;
  private readonly dailyLimitPerUser: number;
  private quota: QuotaWindow = { day: '', total: 0, perUser: new Map() };

  constructor(
    config: ConfigService,
    private readonly queue: QueueProducer,
  ) {
    const network = authNetwork(config);
    const mainnet = network === 'mainnet';
    const rpcUrl =
      config.get<string>('NEAR_AUTH_RPC_URL') ||
      (mainnet ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org');
    const contractId =
      config.get<string>('NEAR_AUTH_CONTRACT_ID') ||
      (mainnet ? 'fast-auth.near' : 'fast-auth.testnet');
    const maxGas = BigInt(config.get<string>('NEAR_AUTH_RELAYER_MAX_GAS') || '300000000000000');
    const auth0Domain =
      config.get<string>('NEAR_AUTH_DOMAIN') ||
      config.get<string>('NEXT_PUBLIC_NEAR_AUTH_DOMAIN') ||
      (mainnet ? 'login.auth.near.org' : 'login.testnet.fast-auth.com');
    const allowedGuardId =
      config.get<string>('NEAR_AUTH_GUARD_ID') || `jwt#https://${auth0Domain}/`;
    this.dailyLimit = Number(config.get<string>('NEAR_AUTH_RELAYER_DAILY_LIMIT') || '1000');
    this.dailyLimitPerUser = Number(
      config.get<string>('NEAR_AUTH_RELAYER_DAILY_LIMIT_PER_USER') || '50',
    );
    let minBalanceYocto = 0n;
    const minBalance = config.get<string>('NEAR_AUTH_RELAYER_MIN_BALANCE');
    if (minBalance) {
      try {
        minBalanceYocto = BigInt(minBalance);
      } catch {
        throw new Error('NEAR_AUTH_RELAYER_MIN_BALANCE must be an integer yoctoNEAR amount.');
      }
    }

    const hint = rpcNetworkHint(rpcUrl);
    if (hint !== 'unknown' && hint !== network) {
      throw new Error(`NEAR_AUTH_RPC_URL points at ${hint} but NEAR_AUTH_NETWORK is ${network}.`);
    }
    if (network === 'testnet' && !contractId.endsWith('.testnet')) {
      throw new Error(`NEAR_AUTH_CONTRACT_ID (${contractId}) is not a testnet contract.`);
    }
    if (network === 'mainnet' && contractId.endsWith('.testnet')) {
      throw new Error(`NEAR_AUTH_CONTRACT_ID (${contractId}) is a testnet contract.`);
    }

    this.relayer = new NearAuthRelayer({
      rpcUrl,
      contractId,
      accountId: config.get<string>('NEAR_AUTH_RELAYER_ACCOUNT_ID') || undefined,
      privateKey: config.get<string>('NEAR_AUTH_RELAYER_PRIVATE_KEY') || undefined,
      maxGas,
      allowedGuardId,
      minBalanceYocto,
    });

    if (!config.get<string>('NEAR_AUTH_RELAYER_ACCOUNT_ID')) {
      this.logger.warn('NEAR Auth relayer is not configured (NEAR_AUTH_RELAYER_ACCOUNT_ID)');
    }
    this.logger.log(
      `NEAR Auth relayer network: ${network} (${contractId}, ${allowedGuardId})`,
    );
  }

  async relay(input: SignActionInput) {
    if (this.queue.enabled) {
      const allowed = await this.queue.reserveNearAuth(
        this.subjectOf(input),
        this.dailyLimit,
        this.dailyLimitPerUser,
      );
      if (!allowed) throw new HttpException('NEAR Auth relayer limit reached', 429);
      return this.queue.relayNearAuth(input);
    }
    this.reserve(this.subjectOf(input));
    return this.relayNow(input);
  }

  /** Executed by the queue worker (or inline when queues are disabled). */
  async relayNow(input: SignActionInput) {
    try {
      const result = await this.relayer.relay(input);
      this.logger.log(`Relayed NEAR Auth sign transaction ${result.txHash}`);
      return result;
    } catch (error) {
      if (error instanceof NearRelayError) {
        throw new HttpException(error.message, error.statusCode);
      }
      throw error;
    }
  }

  /** Rate-limit by the Auth0 subject, so one account cannot drain the relayer. */
  private reserve(subject: string) {
    const day = new Date().toISOString().slice(0, 10);
    if (this.quota.day !== day) {
      this.quota = { day, total: 0, perUser: new Map() };
    }
    const used = this.quota.perUser.get(subject) ?? 0;
    if (this.quota.total >= this.dailyLimit) {
      throw new HttpException('NEAR Auth relayer daily limit reached', 429);
    }
    if (used >= this.dailyLimitPerUser) {
      throw new HttpException('NEAR Auth relayer per-user limit reached', 429);
    }
    this.quota.total += 1;
    this.quota.perUser.set(subject, used + 1);
  }

  /** Read-only decode for rate limiting; the guard verifies the JWT on-chain. */
  private subjectOf(input: SignActionInput): string {
    try {
      const args = JSON.parse(Buffer.from(input.argsBase64, 'base64').toString('utf8')) as {
        verify_payload?: unknown;
      };
      const token = typeof args.verify_payload === 'string' ? args.verify_payload : '';
      const payload = token.split('.')[1];
      if (!payload) return 'unknown';
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const claims = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
        sub?: unknown;
      };
      return typeof claims.sub === 'string' && claims.sub ? claims.sub : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
