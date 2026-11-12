import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { JournalEvent, JournalSourceType } from '@keiz/shared';

export type JournalEntryDocument = HydratedDocument<JournalEntry>;

@Schema({ _id: false })
export class JournalLine {
  @Prop({ required: true })
  accountId: string;

  @Prop({ required: true })
  accountCode: string;

  @Prop({ required: true })
  accountName: string;

  /** Non-negative integer minor units as a string. Exactly one side is non-zero. */
  @Prop({ required: true, default: '0' })
  debit: string;

  @Prop({ required: true, default: '0' })
  credit: string;
}
export const JournalLineSchema = SchemaFactory.createForClass(JournalLine);

@Schema({ timestamps: true, collection: 'journal_entries' })
export class JournalEntry {
  @Prop({ required: true, index: true })
  orgId: string;

  /** Business date, not the insert date. */
  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ required: true })
  memo: string;

  /** Document number for direct-expense/revenue entries, e.g. EXP-26/11/00001. */
  @Prop()
  number?: string;

  @Prop({
    required: true,
    enum: ['invoice', 'receivable', 'receipt', 'manual', 'opening', 'expense', 'revenue'],
  })
  sourceType: JournalSourceType;

  @Prop({ required: true })
  sourceId: string;

  @Prop({
    required: true,
    enum: ['APPROVED', 'PAID', 'VOID', 'ISSUED', 'RECEIVED', 'REVERSED', 'OPENING', 'MANUAL'],
  })
  event: JournalEvent;

  @Prop({ required: true })
  currency: string;

  @Prop({ required: true, default: 2 })
  decimals: number;

  /** Set for system postings. The unique partial index is the idempotency guard. */
  @Prop()
  dedupeKey?: string;

  @Prop({ type: SchemaTypes.ObjectId })
  reversalOf?: Types.ObjectId;

  @Prop()
  postedByUserId?: string;

  @Prop({ type: [JournalLineSchema], required: true })
  lines: JournalLine[];
}

export const JournalEntrySchema = SchemaFactory.createForClass(JournalEntry);
JournalEntrySchema.index({ orgId: 1, date: -1 });
JournalEntrySchema.index({ orgId: 1, sourceType: 1, sourceId: 1 });
JournalEntrySchema.index({ orgId: 1, 'lines.accountCode': 1, date: -1 });
// One posting per (org, source, event). Manual entries omit dedupeKey.
JournalEntrySchema.index(
  { orgId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $exists: true } } },
);
// Direct expense/revenue document numbers are unique per workspace.
JournalEntrySchema.index(
  { orgId: 1, number: 1 },
  { unique: true, partialFilterExpression: { number: { $type: 'string' } } },
);
