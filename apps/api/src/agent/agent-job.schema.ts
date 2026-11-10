import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { AgentJobKind, AgentJobStatus } from '@keiz/shared';

export type AgentJobDocument = HydratedDocument<AgentJob>;

@Schema({ timestamps: true, collection: 'agent_jobs' })
export class AgentJob {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true })
  walletId: string;

  @Prop({ required: true })
  providerId: string;

  @Prop({ required: true })
  providerName: string;

  @Prop({ required: true })
  capability: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  task: string;

  @Prop({ type: Object })
  input?: Record<string, unknown>;

  @Prop({ required: true })
  budgetUsd: string;

  @Prop({ required: true })
  costUsd: string;

  @Prop({ required: true })
  asset: string;

  @Prop({ required: true, default: 'HIRE', enum: ['HIRE', 'API'] })
  kind: AgentJobKind;

  @Prop({
    required: true,
    enum: [
      'QUOTED',
      'PENDING_APPROVAL',
      'APPROVED',
      'EXECUTING',
      'PAID',
      'DONE',
      'BLOCKED',
      'FAILED',
      'CANCELLED',
    ],
    default: 'QUOTED',
  })
  status: AgentJobStatus;

  @Prop({ type: Object })
  policyDecision?: Record<string, unknown>;

  @Prop()
  approvedByUserId?: string;

  @Prop({ type: Object })
  payment?: {
    method: 'mock' | 'intents' | 'custody';
    status: 'UNPAID' | 'PAID' | 'FAILED';
    txHash?: string;
    paidAt?: Date;
  };

  @Prop({ type: Object })
  result?: Record<string, unknown>;

  @Prop()
  resultSummary?: string;

  @Prop()
  error?: string;

  @Prop({ type: Date })
  completedAt?: Date;
}

export const AgentJobSchema = SchemaFactory.createForClass(AgentJob);
AgentJobSchema.index({ orgId: 1, createdAt: -1 });
AgentJobSchema.index({ orgId: 1, status: 1 });
