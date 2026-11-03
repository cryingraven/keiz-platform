import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NearRelayError, SignActionInput, NearAuthRelayer } from './near-tx';

@Injectable()
export class PasskeyService {
  private readonly logger = new Logger(PasskeyService.name);
  private readonly relayer: NearAuthRelayer;

  constructor(config: ConfigService) {
    const network = config.get<string>('NEAR_AUTH_NETWORK') ?? 'testnet';
    const mainnet = network === 'mainnet';
    const rpcUrl =
      config.get<string>('NEAR_AUTH_RPC_URL') ??
      (mainnet ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org');
    const contractId =
      config.get<string>('NEAR_AUTH_CONTRACT_ID') ??
      (mainnet ? 'fast-auth.near' : 'fast-auth.testnet');
    const maxGas = BigInt(
      config.get<string>('NEAR_AUTH_RELAYER_MAX_GAS') ?? '300000000000000',
    );

    this.relayer = new NearAuthRelayer({
      rpcUrl,
      contractId,
      accountId: config.get<string>('NEAR_AUTH_RELAYER_ACCOUNT_ID') || undefined,
      privateKey: config.get<string>('NEAR_AUTH_RELAYER_PRIVATE_KEY') || undefined,
      maxGas,
    });

    if (!config.get<string>('NEAR_AUTH_RELAYER_ACCOUNT_ID')) {
      this.logger.warn('Passkey relayer is not configured (NEAR_AUTH_RELAYER_ACCOUNT_ID)');
    }
  }

  async relay(input: SignActionInput) {
    try {
      return await this.relayer.relay(input);
    } catch (error) {
      if (error instanceof NearRelayError) {
        throw new HttpException(error.message, error.statusCode);
      }
      throw error;
    }
  }
}
