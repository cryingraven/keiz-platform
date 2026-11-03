import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { AgentPolicy, DEFAULT_AGENT_POLICY } from '@keiz/shared';

export type AgentWalletDocument = HydratedDocument<AgentWallet>;

@Schema({ _id: false })
export class AgentPolicyModel implements AgentPolicy {
  @Prop({ required: true })
  perTxLimitUsd: string;

  @Prop({ required: true })
  dailyLimitUsd: string;

  @Prop({ required: true })
  approvalThresholdUsd: string;

  @Prop({ type: [String], required: true })
  allowedAssets: string[];

  @Prop({ required: true, default: true })
  active: boolean;
}
export const AgentPolicySchema = SchemaFactory.createForClass(AgentPolicyModel);

@Schema({ timestamps: true, collection: 'agent_wallets' })
export class AgentWallet {
  @Prop({ required: true, unique: true, index: true })
  orgId: string;

  @Prop({ required: true })
  accountId: string;

  @Prop()
  publicKey?: string;

  @Prop({ default: 'local', enum: ['local', 'outlayer'] })
  provider: 'local' | 'outlayer';

  @Prop()
  outlayerWalletId?: string;

  @Prop()
  outlayerNetwork?: 'mainnet' | 'testnet';

  @Prop()
  outlayerHandoffUrl?: string;

  /** OutLayer API key (AES-256-GCM). Never expose this field through the API. */
  @Prop({ select: false })
  outlayerApiKeyEncrypted?: string;

  /** Local AES-256-GCM key, only for provider=local. Never exposed. */
  @Prop({ select: false })
  encryptedSecret?: string;

  @Prop({ type: AgentPolicySchema, default: DEFAULT_AGENT_POLICY })
  policy: AgentPolicy;

  @Prop({ default: 'ACTIVE', enum: ['ACTIVE', 'PAUSED'] })
  status: string;
}

export const AgentWalletSchema = SchemaFactory.createForClass(AgentWallet);
