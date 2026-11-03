import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { AgentActionStatus } from '@keiz/shared';

export type AgentActionDocument = HydratedDocument<AgentAction>;

@Schema({ timestamps: true, collection: 'agent_actions' })
export class AgentAction {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true })
  walletId: string;

  @Prop({ required: true })
  invoiceId: string;

  @Prop({ required: true, default: 'PAYMENT', enum: ['PAYMENT'] })
  type: string;

  @Prop({ required: true })
  asset: string;

  @Prop({ required: true })
  amountUsd: string;

  @Prop({
    required: true,
    enum: ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'REJECTED', 'EXECUTED', 'BLOCKED', 'FAILED', 'NEEDS_REVIEW'],
    default: 'PENDING_APPROVAL',
  })
  status: AgentActionStatus;

  @Prop()
  reason?: string;

  @Prop({ type: Object })
  policyDecision?: Record<string, unknown>;

  @Prop()
  decidedByUserId?: string;

  @Prop()
  paymentId?: string;

  @Prop()
  outlayerRequestId?: string;

  @Prop()
  outlayerApprovalId?: string;

  @Prop()
  outlayerRequired?: number;

  @Prop()
  outlayerApproved?: number;

  @Prop({ type: Date })
  executedAt?: Date;
}

export const AgentActionSchema = SchemaFactory.createForClass(AgentAction);
AgentActionSchema.index({ orgId: 1, createdAt: -1 });
AgentActionSchema.index({ orgId: 1, status: 1 });
