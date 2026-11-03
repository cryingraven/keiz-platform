import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Interval } from '@nestjs/schedule';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { ChainEvent, ChainEventDocument } from './chain-event.schema';

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);
  private running = false;

  constructor(
    @InjectModel(ChainEvent.name) private readonly events: Model<ChainEventDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    private readonly config: ConfigService,
  ) {}

  private get rpcUrl(): string {
    return this.config.get<string>('NEAR_RPC_URL') ?? 'https://free.rpc.fastnear.com';
  }

  @Interval(30_000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncPending(25);
    } catch (error) {
      this.logger.warn(`Indexer tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Indexes every payment that has an on-chain deposit hash but no chain event yet. */
  async syncPending(limit = 25): Promise<number> {
    // Mock payment hashes are not real transactions - skip them explicitly.
    const pending = await this.payments
      .find({ txHash: { $exists: true, $nin: [null, ''] }, provider: 'intents' })
      .sort({ submittedAt: -1 })
      .limit(limit);

    let indexed = 0;
    for (const payment of pending) {
      const exists = await this.events.exists({
        txHash: payment.txHash,
        eventIndex: 0,
      });
      if (exists) continue;
      try {
        await this.indexPayment(payment);
        indexed += 1;
      } catch (error) {
        this.logger.warn(`Could not index ${payment.txHash}: ${(error as Error).message}`);
      }
    }
    return indexed;
  }

  async backfill(orgId: string, paymentId: string) {
    const payment = await this.payments.findOne({ _id: paymentId, orgId });
    if (!payment) throw new Error('Payment not found');
    return this.indexPayment(payment);
  }

  private async indexPayment(payment: PaymentDocument) {
    if (!payment.txHash) throw new Error('Payment has no tx hash');
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'keiz-indexer',
        method: 'tx',
        params: {
          tx_hash: payment.txHash,
          sender_account_id: payment.payerAccountId,
          wait_until: 'FINAL',
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json()) as {
      result?: {
        final_execution_status?: string;
        transaction_outcome?: {
          block_hash?: string;
          outcome?: { status?: unknown };
        };
        receipts_outcome?: Array<{ id?: string; outcome?: { status?: unknown } }>;
      };
      error?: { message?: string };
    };
    if (json.error || !json.result) {
      throw new Error(json.error?.message ?? 'RPC returned no result');
    }

    const outcome = json.result.transaction_outcome?.outcome?.status;
    const status =
      outcome && typeof outcome === 'object' && 'SuccessValue' in outcome
        ? 'SUCCESS'
        : 'FAILURE';

    const doc = await this.events.findOneAndUpdate(
      { txHash: payment.txHash, eventIndex: 0 },
      {
        $setOnInsert: {
          orgId: payment.orgId,
          paymentId: payment.id,
          txHash: payment.txHash,
          eventIndex: 0,
          kind: 'PAYMENT_DEPOSIT',
          status,
          senderAccountId: payment.payerAccountId ?? 'unknown',
          payload: {
            finalExecutionStatus: json.result.final_execution_status,
            blockHash: json.result.transaction_outcome?.block_hash,
            receiptCount: json.result.receipts_outcome?.length ?? 0,
          },
          observedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    return doc?.toObject();
  }

  list(orgId: string) {
    return this.events.find({ orgId }).sort({ observedAt: -1 }).limit(100).lean();
  }
}
