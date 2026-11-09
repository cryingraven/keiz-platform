import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentAction, AgentActionDocument } from '../agent/agent-action.schema';
import { AgentWallet, AgentWalletDocument } from '../agent/agent-wallet.schema';
import { decryptSecret, deriveMasterKey } from '../agent/agent-crypto';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentEvent, PaymentEventDocument } from '../payments/payment-event.schema';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { PaymentIntentsService } from '../payments/payment-intents.service';
import { QueueProducer } from '../queues/queue-producer.service';
import { mapOutlayerStatus } from './outlayer.mapper';
import { OutlayerService } from './outlayer.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OutlayerPoller {
  private readonly logger = new Logger(OutlayerPoller.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(PaymentEvent.name) private readonly events: Model<PaymentEventDocument>,
    @InjectModel(AgentWallet.name) private readonly wallets: Model<AgentWalletDocument>,
    @InjectModel(AgentAction.name) private readonly actions: Model<AgentActionDocument>,
    private readonly invoices: InvoicesService,
    private readonly outlayer: OutlayerService,
    private readonly config: ConfigService,
    private readonly queue: QueueProducer,
    private readonly intents: PaymentIntentsService,
  ) {}

  private masterKey(): Buffer {
    return deriveMasterKey(
      this.config.get<string>('AGENT_WALLET_MASTER_KEY') || undefined,
      this.config.get<string>('JWT_SECRET'),
    );
  }

  /** Queue sweep: re-arm polls that were lost on a restart. */
  async sweep(): Promise<number> {
    if (!this.outlayer.isEnabled) return 0;
    const open = await this.payments
      .find({ provider: 'outlayer', status: { $in: ['PROCESSING', 'AWAITING_DEPOSIT'] } })
      .select('_id')
      .limit(100);
    for (const payment of open) {
      await this.queue.enqueueOutlayerPoll(String(payment._id), 0);
    }
    return open.length;
  }

  /** Queue processor for one payment. */
  async pollOne(paymentId: string): Promise<'pending' | 'terminal' | 'missing'> {
    if (!this.outlayer.isEnabled) return 'terminal';
    const payment = await this.payments.findById(paymentId);
    if (!payment || payment.provider !== 'outlayer') return 'missing';
    if (!['PROCESSING', 'AWAITING_DEPOSIT'].includes(payment.status)) return 'terminal';
    await this.refresh(payment);
    return ['PROCESSING', 'AWAITING_DEPOSIT'].includes(payment.status)
      ? 'pending'
      : 'terminal';
  }

  private async refresh(payment: PaymentDocument) {
    const requestId = payment.outlayerRequestId ?? payment.correlationId;
    if (!requestId) return;

    const wallet = await this.wallets
      .findOne({ orgId: payment.orgId })
      .select('+outlayerApiKeyEncrypted');
    if (!wallet?.outlayerApiKeyEncrypted) return;

    const apiKey = decryptSecret(wallet.outlayerApiKeyEncrypted, this.masterKey()).toString('utf8');
    const request = await this.outlayer.getRequest(apiKey, requestId);
    const status = mapOutlayerStatus(request.status);

    if (status === payment.status && request.status === payment.rawStatus) return;

    const result = request.result as { intent_hash?: string } | null | undefined;
    const update: Record<string, unknown> = { status, rawStatus: request.status };
    if (result?.intent_hash) update.txHash = result.intent_hash;

    // Atomic claim: duplicate queue jobs must not create duplicate events or
    // advance the invoice twice.
    const updated = await this.payments.findOneAndUpdate(
      { _id: payment._id, status: payment.status, rawStatus: payment.rawStatus },
      { $set: update },
      { returnDocument: 'after' },
    );
    if (!updated) return;
    Object.assign(payment, updated.toObject());

    await this.events.create({
      orgId: payment.orgId,
      paymentId: payment.id,
      status,
      rawStatus: request.status,
      payload: { outlayer: request.result ?? null },
    });

    if (payment.agentActionId) {
      if (request.status === 'pending_approval') {
        await this.actions.updateOne(
          { _id: payment.agentActionId },
          { $set: { status: 'PENDING_APPROVAL' } },
        );
      } else if (status === 'SUCCEEDED') {
        await this.actions.updateOne(
          { _id: payment.agentActionId },
          { $set: { status: 'EXECUTED', executedAt: new Date() } },
        );
      } else if (status === 'PROCESSING') {
        await this.actions.updateOne(
          { _id: payment.agentActionId },
          { $set: { status: 'EXECUTING' } },
        );
      } else if (status === 'NEEDS_REVIEW') {
        await this.actions.updateOne(
          { _id: payment.agentActionId },
          { $set: { status: 'NEEDS_REVIEW' } },
        );
      } else if (status === 'FAILED' || status === 'REFUNDED') {
        await this.actions.updateOne(
          { _id: payment.agentActionId },
          { $set: { status: 'FAILED' } },
        );
      }
    }

    if (status === 'SUCCEEDED') {
      await this.intents.setStatusForPayment(payment.id, 'SETTLED', request.status);
      await this.invoices.markPaid(payment.orgId, payment.invoiceId);
    } else if (status === 'FAILED' || status === 'REFUNDED') {
      await this.intents.setStatusForPayment(payment.id, 'FAILED', request.status);
      await this.invoices.resetForRetry(payment.orgId, payment.invoiceId);
    }
    // NEEDS_REVIEW is terminal but the fund state is unknown: leave the invoice
    // PAYMENT_PENDING and never auto-retry.
  }
}
