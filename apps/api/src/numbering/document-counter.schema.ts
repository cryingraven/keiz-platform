import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { DocumentKind } from '@keiz/shared';

export type DocumentCounterDocument = HydratedDocument<DocumentCounter>;

/**
 * One row per workspace, document kind and UTC month. `seq` is incremented
 * atomically; the unique index is also the guard against a duplicate first
 * insert when two requests race on a fresh month.
 */
@Schema({ timestamps: true, collection: 'document_counters' })
export class DocumentCounter {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, enum: ['BILL', 'INVOICE', 'EXPENSE', 'REVENUE'] })
  kind: DocumentKind;

  /** UTC `YY/MM`, e.g. `26/11`. */
  @Prop({ required: true })
  period: string;

  @Prop({ required: true, default: 0 })
  seq: number;
}

export const DocumentCounterSchema = SchemaFactory.createForClass(DocumentCounter);
DocumentCounterSchema.index({ orgId: 1, kind: 1, period: 1 }, { unique: true });
