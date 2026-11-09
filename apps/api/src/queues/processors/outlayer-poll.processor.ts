import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OutlayerPoller } from '../../outlayer/outlayer.poller';
import {
  OUTLAYER_POLL_JOB,
  OUTLAYER_QUEUE,
  OUTLAYER_SWEEP_JOB,
} from '../queue.constants';
import { QueueProducer } from '../queue-producer.service';

@Processor(OUTLAYER_QUEUE)
export class OutlayerPollProcessor extends WorkerHost {
  private readonly logger = new Logger(OutlayerPollProcessor.name);

  constructor(
    private readonly poller: OutlayerPoller,
    private readonly producer: QueueProducer,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === OUTLAYER_SWEEP_JOB) {
      return { queued: await this.poller.sweep() };
    }
    if (job.name !== OUTLAYER_POLL_JOB) return { skipped: true };

    const paymentId = String(job.data.paymentId);
    const attempt = Number(job.data.attempt || 0);
    try {
      const result = await this.poller.pollOne(paymentId);
      if (result === 'pending') {
        const delay = attempt < 3 ? 5_000 : attempt < 6 ? 30_000 : 300_000;
        await this.producer.enqueueOutlayerPoll(paymentId, delay, attempt + 1);
      }
      return { result };
    } catch (error) {
      const message = (error as Error).message;
      if (/429|operation_limit|rate/i.test(message)) {
        await this.producer.enqueueOutlayerPoll(paymentId, 10 * 60_000, attempt + 1);
        this.logger.warn(`Custody rate limit for ${paymentId}; backing off 10m`);
        return { result: 'rate_limited' };
      }
      throw error;
    }
  }
}
