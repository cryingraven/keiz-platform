import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { DocumentType } from '@keiz/shared';

export type DocumentShareDocument = HydratedDocument<DocumentShare>;

@Schema({ timestamps: true, collection: 'document_shares' })
export class DocumentShare {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, enum: ['bill', 'invoice'] })
  documentType: DocumentType;

  @Prop({ required: true })
  documentId: string;

  /** SHA-256 of the bearer token. The raw token is only returned once. */
  @Prop({ required: true, unique: true, index: true })
  tokenHash: string;

  @Prop({ type: Date, required: true, index: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  revokedAt?: Date | null;

  @Prop({ required: true })
  createdByUserId: string;

  @Prop({ default: 0 })
  viewCount: number;

  @Prop({ type: Date, default: null })
  lastViewedAt?: Date | null;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const DocumentShareSchema = SchemaFactory.createForClass(DocumentShare);
DocumentShareSchema.index({ orgId: 1, documentType: 1, documentId: 1 }, { unique: true });
