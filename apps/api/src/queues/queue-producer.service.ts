import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import type { RelayResult, SignActionInput } from '../auth/near-tx';
import {
  INDEXER_QUEUE,
  INDEXER_SYNC_JOB,
  NEAR_AUTH_QUEUE,
  NEAR_AUTH_RELAY_JOB,
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
  private events?: QueueEvents;
  private redisClient?: Redis;

  constructor(
    @Optional() @InjectQueue(PAYMENTS_QUEUE) private readonly payments?: Queue,
    @Optional() @InjectQueue(OUTLAYER_QUEUE) private readonly outlayer?: Queue,
    @Optional() @InjectQueue(INDEXER_QUEUE) private readonly indexer?: Queue,
    @Optional() @InjectQueue(NEAR_AUTH_QUEUE) private readonly nearAuth?: Queue,
  ) {}

  get enabled(): boolean {
    return Boolean(this.payments && this.outlayer && this.indexer && this.nearAuth);
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

  async relayNearAuth(input: SignActionInput): Promise<RelayResult> {
    if (!this.nearAuth) {
      throw new Error('NEAR Auth relay queue is disabled');
    }
    const job = await this.nearAuth.add(NEAR_AUTH_RELAY_JOB, input, {
      jobId: `near-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
    const events = this.queueEvents();
    return (await job.waitUntilFinished(events, 30_000)) as RelayResult;
  }

  /** Shared daily quota backed by Redis, so multiple API instances agree. */
  async reserveNearAuth(
    subject: string,
    dailyLimit: number,
    perUserLimit: number,
  ): Promise<boolean> {
    if (!this.nearAuth) return true;
    const client = this.redis();
    const day = new Date().toISOString().slice(0, 10);
    const prefix = process.env.QUEUE_PREFIX || 'keiz';
    const userKey = `${prefix}:near-auth:quota:${day}:${subject}`;
    const totalKey = `${prefix}:near-auth:quota:${day}:total`;
    const results = await client
      .multi()
      .incr(userKey)
      .expire(userKey, 2 * 86_400)
      .incr(totalKey)
      .expire(totalKey, 2 * 86_400)
      .exec();
    const used = Number(results?.[0]?.[1] ?? 0);
    const total = Number(results?.[2]?.[1] ?? 0);
    return used <= perUserLimit && total <= dailyLimit;
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
    await this.events?.close();
    this.redisClient?.disconnect();
  }

  private redis(): Redis {
    if (!this.redisClient) {
      this.redisClient = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
        maxRetriesPerRequest: null,
      });
    }
    return this.redisClient;
  }

  private queueEvents(): QueueEvents {
    if (!this.events) {
      this.events = new QueueEvents(NEAR_AUTH_QUEUE, {
        connection: { url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' },
        prefix: process.env.QUEUE_PREFIX || 'keiz',
      });
    }
    return this.events;
  }
}
