import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PaymentAttempt,
  PaymentAttemptDocument,
  PaymentIntent,
  PaymentIntentDocument,
  PaymentIntentStatus,
  PaymentRail,
} from './payment-intent.schema';

@Injectable()
export class PaymentIntentsService {
  private readonly logger = new Logger(PaymentIntentsService.name);

  constructor(
    @InjectModel(PaymentIntent.name) private readonly intents: Model<PaymentIntentDocument>,
    @InjectModel(PaymentAttempt.name) private readonly attempts: Model<PaymentAttemptDocument>,
  ) {}

  async reserve(params: {
    orgId: string;
    invoiceId: string;
    amount: string;
    currency?: string;
    rail: PaymentRail;
    createdByUserId?: string;
  }): Promise<PaymentIntentDocument> {
    try {
      return await this.intents.create({
        orgId: params.orgId,
        invoiceId: params.invoiceId,
        amount: params.amount,
        currency: params.currency ?? 'USD',
        rail: params.rail,
        status: 'OPEN',
        createdByUserId: params.createdByUserId,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(
          'This invoice already has an open payment intent on another rail',
        );
      }
      throw error;
    }
  }

  async attachPayment(intentId: string, paymentId: string, providerRequestId?: string) {
    const intent = await this.intents.findById(intentId);
    if (!intent) return null;
    intent.paymentId = paymentId;
    intent.status = 'EXECUTING';
    await intent.save();
    await this.attempts.create({
      intentId,
      orgId: intent.orgId,
      rail: intent.rail,
      status: 'EXECUTING',
      paymentId,
      providerRequestId,
    });
    return intent;
  }

  async setStatusForPayment(
    paymentId: string,
    status: PaymentIntentStatus,
    providerStatus?: string,
  ) {
    const intent = await this.intents.findOneAndUpdate(
      { paymentId },
      {
        $set: {
          status,
          ...(status === 'SETTLED' ? { settledAt: new Date() } : {}),
        },
      },
      { returnDocument: 'after' },
    );
    if (!intent) return null;
    await this.attempts.updateMany(
      { intentId: String(intent._id) },
      { $set: { status, ...(providerStatus ? { providerStatus } : {}) } },
    );
    return intent;
  }

  async cancel(intentId: string) {
    await this.intents.updateOne(
      { _id: intentId, status: { $in: ['OPEN', 'EXECUTING'] } },
      { $set: { status: 'CANCELLED' } },
    );
    await this.attempts.updateMany(
      { intentId, status: { $in: ['PENDING', 'EXECUTING'] } },
      { $set: { status: 'CANCELLED' } },
    );
  }

  async setStatus(intentId: string, status: PaymentIntentStatus) {
    await this.intents.updateOne(
      { _id: intentId },
      { $set: { status, ...(status === 'SETTLED' ? { settledAt: new Date() } : {}) } },
    );
  }

  async hasOpenIntent(orgId: string, invoiceId: string) {
    return Boolean(
      await this.intents.exists({
        orgId,
        invoiceId,
        status: { $in: ['OPEN', 'EXECUTING'] },
      }),
    );
  }

  async findOpenIntent(orgId: string, invoiceId: string) {
    return this.intents.findOne({
      orgId,
      invoiceId,
      status: { $in: ['OPEN', 'EXECUTING'] },
    });
  }
}
