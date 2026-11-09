import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  INDEXER_QUEUE,
  INDEXER_SYNC_JOB,
  OUTLAYER_POLL_JOB,
  OUTLAYER_QUEUE,
  OUTLAYER_SWEEP_JOB,
  PAYMENT_POLL_JOB,
  PAYMENT_SWEEP_JOB,
  PAYMENTS_QUEUE,
} from './queue.constants';

/**
 * Producers are safe to use in the API and worker. When QUEUES_ENABLED=false
 * (unit/smoke tests) all methods become no-ops.
 */
@Injectable()
export class QueueProducer {
  private readonly logger = new Logger(QueueProducer.name);

  constructor(
    @Optional() @InjectQueue(PAYMENTS_QUEUE) private readonly payments?: Queue,
    @Optional() @InjectQueue(OUTLAYER_QUEUE) private readonly outlayer?: Queue,
    @Optional() @InjectQueue(INDEXER_QUEUE) private readonly indexer?: Queue,
  ) {}

  get enabled(): boolean {
    return Boolean(this.payments && this.outlayer && this.indexer);
  }

  async enqueuePaymentPoll(paymentId: string, delayMs = 4_000): Promise<void> {
    if (!this.payments) return;
    await this.payments.add(
      PAYMENT_POLL_JOB,
      { paymentId },
      {
        jobId: `payment-${paymentId}-${Date.now()}`,
        delay: delayMs,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 5_000,
      },
    );
  }

  async enqueueOutlayerPoll(paymentId: string, delayMs = 2_000, attempt = 0): Promise<void> {
    if (!this.outlayer) return;
    await this.outlayer.add(
      OUTLAYER_POLL_JOB,
      { paymentId, attempt },
      {
        jobId: `outlayer-${paymentId}-${Date.now()}`,
        delay: delayMs,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 5_000,
      },
    );
  }

  async enqueueOutlayerSweep(): Promise<void> {
    if (!this.outlayer) return;
    await this.outlayer.add(
      OUTLAYER_SWEEP_JOB,
      {},
      {
        jobId: `outlayer-sweep-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: 1_000,
      },
    );
  }

  async enqueueIndexerSync(): Promise<void> {
    if (!this.indexer) return;
    await this.indexer.add(
      INDEXER_SYNC_JOB,
      {},
      {
        jobId: `indexer-${Date.now()}`,
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: 1_000,
      },
    );
  }

  async ensureSchedules(): Promise<void> {
    if (!this.enabled) return;
    const paymentEvery = Number(process.env.PAYMENT_SWEEP_INTERVAL_MS || 30_000);
    const indexerEvery = Number(process.env.INDEXER_INTERVAL_MS || 30_000);
    try {
      await this.payments!.upsertJobScheduler(
        'payment-sweep',
        { every: paymentEvery },
        { name: PAYMENT_SWEEP_JOB, data: {} },
      );
      await this.outlayer!.upsertJobScheduler(
        'outlayer-sweep',
        { every: 300_000 },
        { name: OUTLAYER_SWEEP_JOB, data: {} },
      );
      await this.indexer!.upsertJobScheduler(
        'indexer-sync',
        { every: indexerEvery },
        { name: INDEXER_SYNC_JOB, data: {} },
      );
    } catch (error) {
      this.logger.warn(`Could not install queue schedules: ${(error as Error).message}`);
    }
  }

  async close(): Promise<void> {
    // Producers have no owned connections once the NEAR Auth relay queue is gone.
  }
}
