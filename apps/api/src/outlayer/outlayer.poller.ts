import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Interval } from '@nestjs/schedule';
import { AgentAction, AgentActionDocument } from '../agent/agent-action.schema';
import { AgentWallet, AgentWalletDocument } from '../agent/agent-wallet.schema';
import { decryptSecret, deriveMasterKey } from '../agent/agent-crypto';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentEvent, PaymentEventDocument } from '../payments/payment-event.schema';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { mapOutlayerStatus } from './outlayer.mapper';
import { OutlayerService } from './outlayer.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OutlayerPoller {
  private readonly logger = new Logger(OutlayerPoller.name);
  private running = false;
  /**
   * Free custody tiers are measured per operation, so a fixed 5s poll can burn
   * a wallet's daily quota in under two hours. Poll aggressively right after a
   * request, then back off hard. State is per-process and intentionally cheap.
   */
  private readonly pollState = new Map<string, { count: number; nextAt: number }>();

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(PaymentEvent.name) private readonly events: Model<PaymentEventDocument>,
    @InjectModel(AgentWallet.name) private readonly wallets: Model<AgentWalletDocument>,
    @InjectModel(AgentAction.name) private readonly actions: Model<AgentActionDocument>,
    private readonly invoices: InvoicesService,
    private readonly outlayer: OutlayerService,
    private readonly config: ConfigService,
  ) {}

  private masterKey(): Buffer {
    return deriveMasterKey(
      this.config.get<string>('AGENT_WALLET_MASTER_KEY') || undefined,
      this.config.get<string>('JWT_SECRET'),
    );
  }

  private isDue(paymentId: string): boolean {
    const state = this.pollState.get(paymentId);
    return !state || Date.now() >= state.nextAt;
  }

  private schedule(paymentId: string) {
    const state = this.pollState.get(paymentId) ?? { count: 0, nextAt: 0 };
    state.count += 1;
    // Fast right after submission, then 30s, then 5m. This keeps quota use low
    // while still settling a normal request within a few seconds.
    const delay = state.count <= 3 ? 5_000 : state.count <= 6 ? 30_000 : 300_000;
    state.nextAt = Date.now() + delay;
    this.pollState.set(paymentId, state);
  }

  private coolDown(paymentId: string) {
    this.pollState.set(paymentId, {
      count: 10,
      nextAt: Date.now() + 10 * 60_000,
    });
  }

  @Interval(5_000)
  async tick() {
    if (this.running || !this.outlayer.isEnabled) return;
    this.running = true;
    try {
      const open = await this.payments
        .find({ provider: 'outlayer', status: { $in: ['PROCESSING', 'AWAITING_DEPOSIT'] } })
        .limit(25);

      for (const payment of open) {
        if (!this.isDue(payment.id)) continue;
        try {
          await this.refresh(payment);
          if (['PROCESSING', 'AWAITING_DEPOSIT'].includes(payment.status)) {
            this.schedule(payment.id);
          } else {
            this.pollState.delete(payment.id);
          }
        } catch (error) {
          const message = (error as Error).message;
          if (/429|operation_limit|rate/i.test(message)) {
            this.coolDown(payment.id);
          } else {
            this.schedule(payment.id);
          }
          this.logger.warn(`Custody poll failed for ${payment.id}: ${message}`);
        }
      }
    } finally {
      this.running = false;
    }
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

    payment.status = status;
    payment.rawStatus = request.status;
    const result = request.result as { intent_hash?: string } | null | undefined;
    if (result?.intent_hash) payment.txHash = result.intent_hash;
    await payment.save();

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
      await this.invoices.markPaid(payment.orgId, payment.invoiceId);
    } else if (status === 'FAILED' || status === 'REFUNDED') {
      await this.invoices.resetForRetry(payment.orgId, payment.invoiceId);
    }
    // NEEDS_REVIEW is terminal but the fund state is unknown: leave the invoice
    // PAYMENT_PENDING and never auto-retry.
  }
}
