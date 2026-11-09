import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PaymentsService } from '../../payments/payments.service';
import { PAYMENT_POLL_JOB, PAYMENT_SWEEP_JOB, PAYMENTS_QUEUE } from '../queue.constants';
import { QueueProducer } from '../queue-producer.service';

@Processor(PAYMENTS_QUEUE)
export class PaymentPollProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentPollProcessor.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly producer: QueueProducer,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === PAYMENT_SWEEP_JOB) {
      return { changed: await this.payments.pollOpen() };
    }
    if (job.name !== PAYMENT_POLL_JOB) return { skipped: true };

    const paymentId = String(job.data.paymentId);
    const result = await this.payments.pollOne(paymentId);
    if (result === 'pending') {
      await this.producer.enqueuePaymentPoll(paymentId, 4_000);
    } else if (result === 'missing') {
      this.logger.warn(`Payment ${paymentId} no longer exists`);
    }
    return { result };
  }
}
