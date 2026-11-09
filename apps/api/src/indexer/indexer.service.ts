import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { formatUnits, parseUnits } from '@keiz/shared';
import { fetchRpcWithRetry } from '../common/rpc-client';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { ReceivablesService } from '../receivables/receivables.service';
import { ChainEvent, ChainEventDocument } from './chain-event.schema';
import { IndexerCursor, IndexerCursorDocument } from './indexer-cursor.schema';
import { Organization, OrganizationDocument } from '../users/organization.schema';

interface CollectReceipt {
  id: number;
  token: string;
  sender: string;
  amount: string;
  receivable_ref?: string;
  receivableRef?: string;
  block_height: number;
  observed_at: number;
}

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);

  constructor(
    @InjectModel(ChainEvent.name) private readonly events: Model<ChainEventDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(IndexerCursor.name) private readonly cursors: Model<IndexerCursorDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    private readonly receivables: ReceivablesService,
    private readonly config: ConfigService,
  ) {}

  private get rpcUrl(): string {
    return this.config.get<string>('NEAR_RPC_URL') || 'https://free.rpc.fastnear.com';
  }

  async syncAll(limit = 25): Promise<{ payments: number; collect: number }> {
    const payments = await this.syncPending(limit);
    const collect = await this.syncCollectReceipts(100);
    return { payments, collect };
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
        orgId: payment.orgId,
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

  /**
   * Pulls receipts from the configured keiz-collect contract. The contract does
   * not know the transaction hash, so its stable receipt id is the idempotency
   * key and the synthetic txHash used by chain_events.
   */
  async syncCollectReceipts(limit = 100): Promise<number> {
    const orgs = await this.orgs
      .find({ 'collection.status': 'ACTIVE' })
      .select('_id collection')
      .limit(100)
      .lean();
    let indexed = 0;
    for (const org of orgs) {
      const collection = org.collection as
        | {
            contractId: string;
            network: 'mainnet' | 'testnet';
            tokenContract: string;
            decimals: number;
          }
        | undefined;
      if (!collection?.contractId) continue;
      try {
        indexed += await this.syncCollectForOrg(String(org._id), collection, limit);
      } catch (error) {
        this.logger.warn(
          `Collect index failed for org ${String(org._id)} (${collection.contractId}): ${(error as Error).message}`,
        );
      }
    }
    return indexed;
  }

  private async syncCollectForOrg(
    orgId: string,
    collection: {
      contractId: string;
      network: 'mainnet' | 'testnet';
      tokenContract: string;
      decimals: number;
    },
    limit: number,
  ): Promise<number> {
    const { contractId, tokenContract, decimals: tokenDecimals } = collection;
    const rpcUrl = this.rpcFor(collection.network);
    const count = Number(
      await this.viewContract<number>(rpcUrl, contractId, 'get_receipt_count', {}),
    );
    if (!Number.isFinite(count) || count <= 0) return 0;
    const cursorKey = `collect:${orgId}:${contractId}`;
    const cursor = await this.cursors.findOne({ key: cursorKey }).lean();
    const from = cursor ? cursor.value + 1 : 0;
    if (from >= count) return 0;
    const receipts = await this.viewContract<CollectReceipt[]>(
      rpcUrl,
      contractId,
      'get_receipts',
      {
        from_index: from,
        limit: Math.min(limit, count - from),
      },
    );

    let indexed = 0;
    for (const receipt of receipts ?? []) {
      const reference = receipt.receivable_ref ?? receipt.receivableRef;
      const chainEventId = `collect:${orgId}:${contractId}:${receipt.id}`;
      const existing = await this.events.exists({
        orgId,
        txHash: chainEventId,
        eventIndex: 0,
      });
      if (existing) continue;

      if (receipt.token !== tokenContract) {
        await this.recordCollectEvent(orgId, chainEventId, receipt, 'IGNORED', {
          reason: `unexpected token ${receipt.token}`,
        });
        continue;
      }

      const receivable = reference
        ? await this.receivables.findByNumber(orgId, reference)
        : null;
      if (!receivable) {
        await this.recordCollectEvent(orgId, chainEventId, receipt, 'IGNORED', {
          reason: `unknown receivable ${reference ?? ''}`,
        });
        continue;
      }
      if (!['ISSUED', 'PARTIALLY_PAID'].includes(receivable.status)) {
        await this.recordCollectEvent(orgId, chainEventId, receipt, 'IGNORED', {
          reason: `receivable is ${receivable.status}`,
        });
        continue;
      }
      if (await this.receivables.hasChainEvent(orgId, chainEventId)) {
        await this.recordCollectEvent(orgId, chainEventId, receipt, 'SUCCESS', {});
        continue;
      }

      try {
        const amount = formatUnits(receipt.amount, tokenDecimals);
        await this.receivables.recordReceipt(orgId, 'system:indexer', String(receivable._id), {
          amount,
          receivedAt: new Date(Number(receipt.observed_at) / 1_000_000).toISOString(),
          method: 'ONCHAIN',
          txHash: chainEventId,
          chainEventId,
          receivableRef: reference ?? undefined,
          tokenContract: receipt.token,
          sender: receipt.sender,
        });
        await this.recordCollectEvent(orgId, chainEventId, receipt, 'SUCCESS', {});
        indexed += 1;
      } catch (error) {
        await this.recordCollectEvent(orgId, chainEventId, receipt, 'IGNORED', {
          reason: (error as Error).message,
        });
      }
    }
    const lastId = (receipts ?? []).reduce(
      (max, receipt) => Math.max(max, Number(receipt.id)),
      from - 1,
    );
    if (lastId >= from) {
      await this.cursors.updateOne(
        { key: cursorKey },
        { $set: { value: lastId } },
        { upsert: true },
      );
    }
    return indexed;
  }

  private async recordCollectEvent(
    orgId: string,
    chainEventId: string,
    receipt: CollectReceipt,
    status: 'SUCCESS' | 'IGNORED',
    extra: Record<string, unknown>,
  ) {
    await this.events.findOneAndUpdate(
      { orgId, txHash: chainEventId, eventIndex: 0 },
      {
        $setOnInsert: {
          orgId,
          txHash: chainEventId,
          eventIndex: 0,
          kind: 'AR_RECEIPT',
          status,
          blockHeight: receipt.block_height,
          senderAccountId: receipt.sender,
          payload: { receipt, ...extra },
          observedAt: new Date(Number(receipt.observed_at) / 1_000_000),
        },
      },
      { upsert: true },
    );
  }

  private rpcFor(network: 'mainnet' | 'testnet'): string {
    if (network === 'testnet') {
      return this.config.get<string>('NEAR_AUTH_RPC_URL') || 'https://rpc.testnet.near.org';
    }
    return this.config.get<string>('NEAR_RPC_URL') || 'https://free.rpc.fastnear.com';
  }

  private async viewContract<T>(
    rpcUrl: string,
    contractId: string,
    method: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetchRpcWithRetry(
      rpcUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'keiz-collect-indexer',
          method: 'query',
          params: {
            request_type: 'call',
            finality: 'final',
            account_id: contractId,
            method_name: method,
            args: Buffer.from(JSON.stringify(args)).toString('base64'),
          },
        }),
      },
      { timeoutMs: 15_000 },
    );
    const json = (await response.json()) as {
      result?: { result?: string };
      error?: { message?: string };
    };
    if (json.error || !json.result?.result) {
      throw new Error(json.error?.message ?? 'Collect contract returned no result');
    }
    const decoded = Buffer.from(json.result.result, 'base64').toString('utf8');
    return JSON.parse(decoded) as T;
  }

  private async indexPayment(payment: PaymentDocument) {
    if (!payment.txHash) throw new Error('Payment has no tx hash');
    const response = await fetchRpcWithRetry(
      this.rpcUrl,
      {
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
      },
      { timeoutMs: 15_000 },
    );
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
      { orgId: payment.orgId, txHash: payment.txHash, eventIndex: 0 },
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
