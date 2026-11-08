import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { paymentsMode, rpcNetworkHint, walletNetwork } from '../common/network';
import { IntentsPaymentProvider } from './providers/intents.provider';
import { MockPaymentProvider } from './providers/mock.provider';
import { PaymentProvider } from './providers/provider';

@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  private readonly provider: PaymentProvider;

  constructor(config: ConfigService) {
    const mode = paymentsMode(config);
    if (mode === 'intents') {
      const network = walletNetwork(config);
      if (network !== 'mainnet') {
        throw new Error(
          'PAYMENTS_MODE=intents is mainnet-only. Set CHAIN_NETWORK=mainnet and a mainnet RPC.',
        );
      }
      const rpcUrl = config.get<string>('NEAR_RPC_URL') || '';
      if (rpcNetworkHint(rpcUrl) === 'testnet') {
        throw new Error('PAYMENTS_MODE=intents requires NEAR_RPC_URL on mainnet.');
      }
      this.logger.warn(
        'PAYMENTS_MODE=intents - 1Click is MAINNET ONLY. Real funds can move.',
      );
      this.provider = new IntentsPaymentProvider({
        baseUrl: config.get<string>('NEAR_INTENTS_BASE_URL') || 'https://1click.chaindefuser.com',
        jwt: config.get<string>('NEAR_INTENTS_JWT') || undefined,
        referral: config.get<string>('NEAR_INTENTS_REFERRAL') || undefined,
      });
    } else {
      this.logger.log('PAYMENTS_MODE=mock - no network calls, deterministic statuses');
      this.provider = new MockPaymentProvider();
    }
  }

  get(): PaymentProvider {
    return this.provider;
  }

  mock(): MockPaymentProvider {
    if (!(this.provider instanceof MockPaymentProvider)) {
      throw new Error('Mock controls are unavailable when PAYMENTS_MODE=intents');
    }
    return this.provider;
  }
}
