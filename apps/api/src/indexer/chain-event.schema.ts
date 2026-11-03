import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChainEventDocument = HydratedDocument<ChainEvent>;

/**
 * Normalised on-chain observation. Upserted by (txHash, eventIndex) so re-polling
 * never duplicates history.
 */
@Schema({ timestamps: true, collection: 'chain_events' })
export class ChainEvent {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ index: true })
  paymentId?: string;

  @Prop({ required: true })
  txHash: string;

  @Prop({ required: true, default: 0 })
  eventIndex: number;

  @Prop({ required: true })
  kind: string;

  @Prop()
  status?: string;

  @Prop()
  blockHeight?: number;

  @Prop({ required: true })
  senderAccountId: string;

  @Prop({ type: Object })
  payload?: Record<string, unknown>;

  @Prop({ type: Date, required: true })
  observedAt: Date;
}

export const ChainEventSchema = SchemaFactory.createForClass(ChainEvent);
ChainEventSchema.index({ txHash: 1, eventIndex: 1 }, { unique: true });
ChainEventSchema.index({ orgId: 1, observedAt: -1 });
