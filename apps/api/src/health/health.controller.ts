import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get()
  health() {
    return {
      ok: true,
      service: 'keiz-api',
      paymentsMode: this.config.get('PAYMENTS_MODE') ?? 'mock',
      network: this.config.get('NEAR_NETWORK') ?? 'mainnet',
      time: new Date().toISOString(),
    };
  }
}
