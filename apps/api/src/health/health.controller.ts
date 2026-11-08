import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { auditNetworkConfig } from '../common/network';
import { Public } from '../common/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get()
  health() {
    try {
      const network = auditNetworkConfig(this.config);
      return {
        ok: true,
        service: 'keiz-api',
        network: network.walletNetwork,
        authNetwork: network.authNetwork,
        outlayerNetwork: network.outlayerNetwork,
        paymentsMode: network.paymentsMode,
        warnings: network.warnings,
        time: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        service: 'keiz-api',
        error: (error as Error).message,
        time: new Date().toISOString(),
      };
    }
  }
}
