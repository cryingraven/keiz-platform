import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PaymentIntentDocument = HydratedDocument<PaymentIntent>;
export type PaymentAttemptDocument = HydratedDocument<PaymentAttempt>;

export type PaymentRail = 'oneclick' | 'outlayer' | 'vault';
export type PaymentIntentStatus =
  | 'OPEN'
  | 'EXECUTING'
  | 'SETTLED'
  | 'FAILED'
  | 'CANCELLED';

/** One payment obligation per invoice; exactly one live intent per invoice. */
@Schema({ timestamps: true, collection: 'payment_intents' })
export class PaymentIntent {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, index: true })
  invoiceId: string;

  @Prop({ required: true })
  amount: string;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop({ required: true, enum: ['oneclick', 'outlayer', 'vault'] })
  rail: PaymentRail;

  @Prop({
    required: true,
    enum: ['OPEN', 'EXECUTING', 'SETTLED', 'FAILED', 'CANCELLED'],
    default: 'OPEN',
  })
  status: PaymentIntentStatus;

  @Prop()
  paymentId?: string;

  @Prop()
  createdByUserId?: string;

  @Prop()
  settledAt?: Date;
}

export const PaymentIntentSchema = SchemaFactory.createForClass(PaymentIntent);
// One live payment intent per invoice, across every rail.
PaymentIntentSchema.index(
  { orgId: 1, invoiceId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['OPEN', 'EXECUTING'] } },
  },
);
PaymentIntentSchema.index({ orgId: 1, status: 1, createdAt: -1 });

/** One row per execution attempt against a rail. */
@Schema({ timestamps: true, collection: 'payment_attempts' })
export class PaymentAttempt {
  @Prop({ required: true, index: true })
  intentId: string;

  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, enum: ['oneclick', 'outlayer', 'vault'] })
  rail: PaymentRail;

  @Prop({ required: true, default: 'PENDING' })
  status: string;

  @Prop()
  paymentId?: string;

  @Prop()
  providerRequestId?: string;

  @Prop()
  providerStatus?: string;

  @Prop({ type: Object })
  payload?: Record<string, unknown>;
}

export const PaymentAttemptSchema = SchemaFactory.createForClass(PaymentAttempt);
PaymentAttemptSchema.index({ intentId: 1, createdAt: -1 });
PaymentAttemptSchema.index({ orgId: 1, createdAt: -1 });
