import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

@Injectable()
export class PaymentPollerService {
  private readonly logger = new Logger(PaymentPollerService.name);
  private running = false;

  constructor(private readonly payments: PaymentsService) {}

  @Interval(4000)
  async tick() {
    if (this.running) return; // never overlap runs
    this.running = true;
    try {
      const changed = await this.payments.pollOpen();
      if (changed > 0) this.logger.log(`Advanced ${changed} payment(s)`);
    } catch (error) {
      this.logger.error(`Payment poll failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
