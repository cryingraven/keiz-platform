import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AgentDailySpendDocument = HydratedDocument<AgentDailySpend>;

/** One row per org per UTC day. Updated with an atomic conditional $inc. */
@Schema({ timestamps: true, collection: 'agent_daily_spend' })
export class AgentDailySpend {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true })
  day: string;

  @Prop({ required: true, default: 0 })
  spentCents: number;
}

export const AgentDailySpendSchema = SchemaFactory.createForClass(AgentDailySpend);
AgentDailySpendSchema.index({ orgId: 1, day: 1 }, { unique: true });
