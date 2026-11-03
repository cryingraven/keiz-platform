import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntentsPaymentProvider } from './providers/intents.provider';
import { MockPaymentProvider } from './providers/mock.provider';
import { PaymentProvider } from './providers/provider';

@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  private readonly provider: PaymentProvider;

  constructor(config: ConfigService) {
    const mode = config.get<string>('PAYMENTS_MODE') ?? 'mock';
    if (mode === 'intents') {
      this.logger.warn(
        'PAYMENTS_MODE=intents - 1Click is MAINNET ONLY. Real funds can move.',
      );
      this.provider = new IntentsPaymentProvider({
        baseUrl: config.get<string>('NEAR_INTENTS_BASE_URL') ?? 'https://1click.chaindefuser.com',
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
