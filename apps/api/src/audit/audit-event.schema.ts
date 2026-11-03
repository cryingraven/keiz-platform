import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuditEventDocument = HydratedDocument<AuditEvent>;

@Schema({ timestamps: true, collection: 'audit_events' })
export class AuditEvent {
  @Prop({ index: true })
  orgId?: string;

  @Prop({ index: true })
  actorUserId?: string;

  @Prop()
  accountId?: string;

  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  method: string;

  @Prop({ required: true })
  path: string;

  @Prop({ required: true })
  status: number;

  @Prop()
  ip?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);
AuditEventSchema.index({ orgId: 1, createdAt: -1 });
