import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PaymentEventDocument = HydratedDocument<PaymentEvent>;

/** Append-only audit trail. Never update or delete rows in this collection. */
@Schema({ timestamps: true, collection: 'payment_events' })
export class PaymentEvent {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, index: true })
  paymentId: string;

  @Prop({ required: true })
  status: string;

  @Prop()
  rawStatus?: string;

  @Prop({ type: Object })
  payload?: Record<string, unknown>;
}

export const PaymentEventSchema = SchemaFactory.createForClass(PaymentEvent);
PaymentEventSchema.index({ orgId: 1, createdAt: -1 });
