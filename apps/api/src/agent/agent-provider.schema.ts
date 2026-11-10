import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AgentProviderDocument = HydratedDocument<AgentProvider>;

@Schema({ timestamps: true, collection: 'agent_providers' })
export class AgentProvider {
  @Prop({ required: true, unique: true, index: true })
  slug: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  capability: string;

  @Prop({ required: true })
  priceUsd: string;

  @Prop({ required: true, default: 'nep141:usdc.near' })
  asset: string;

  @Prop({ required: true })
  accountId: string;

  @Prop({ required: true, default: 'local', enum: ['local', 'http'] })
  mode: 'local' | 'http';

  @Prop({ default: true })
  active: boolean;
}

export const AgentProviderSchema = SchemaFactory.createForClass(AgentProvider);
AgentProviderSchema.index({ capability: 1, active: 1 });
