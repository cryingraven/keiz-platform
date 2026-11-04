import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { RECEIPT_METHODS, ReceiptMethod, ReceivableStatus } from '@keiz/shared';

export type ReceivableDocument = HydratedDocument<Receivable>;

@Schema({ _id: false })
export class ReceivableLine {
  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  quantity: string;

  @Prop({ required: true })
  unitPrice: string;

  /** quantity * unitPrice, integer minor units as a string. */
  @Prop({ required: true })
  lineTotal: string;
}
export const ReceivableLineSchema = SchemaFactory.createForClass(ReceivableLine);

@Schema({ _id: false })
export class Receipt {
  /** Client-generated so the ledger posting is idempotent. */
  @Prop({ required: true })
  receiptId: string;

  /** Integer minor units as a string. */
  @Prop({ required: true })
  amount: string;

  @Prop({ required: true })
  currency: string;

  @Prop({ required: true, default: 2 })
  decimals: number;

  @Prop({ type: Date, required: true })
  receivedAt: Date;

  @Prop({ required: true, enum: RECEIPT_METHODS, default: 'BANK_TRANSFER' })
  method: ReceiptMethod;

  @Prop()
  reference?: string;

  @Prop()
  txHash?: string;

  @Prop({ required: true })
  recordedByUserId: string;
}
export const ReceiptSchema = SchemaFactory.createForClass(Receipt);

@Schema({ timestamps: true, collection: 'receivables' })
export class Receivable {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, index: true })
  customerId: string;

  @Prop({ required: true })
  number: string;

  @Prop({ type: Date, required: true })
  issueDate: Date;

  @Prop({ type: Date, required: true })
  dueDate: Date;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop({ required: true, default: 2 })
  decimals: number;

  @Prop({ type: [ReceivableLineSchema], required: true })
  lineItems: ReceivableLine[];

  @Prop({ required: true })
  subtotal: string;

  @Prop({ required: true, default: 0 })
  taxBps: number;

  @Prop({ required: true })
  taxAmount: string;

  @Prop({ required: true })
  total: string;

  /** Sum of all receipts, integer minor units. */
  @Prop({ required: true, default: '0' })
  paidAmount: string;

  @Prop({
    required: true,
    enum: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'],
    default: 'DRAFT',
  })
  status: ReceivableStatus;

  @Prop()
  notes?: string;

  @Prop({ required: true })
  createdByUserId: string;

  @Prop({ type: [ReceiptSchema], default: [] })
  receipts: Receipt[];

  @Prop({ type: Date })
  issuedAt?: Date;

  @Prop({ type: Date })
  voidedAt?: Date;
}

export const ReceivableSchema = SchemaFactory.createForClass(Receivable);
ReceivableSchema.index({ orgId: 1, number: 1 }, { unique: true });
ReceivableSchema.index({ orgId: 1, createdAt: -1 });
ReceivableSchema.index({ orgId: 1, status: 1 });
ReceivableSchema.index({ orgId: 1, dueDate: 1 });
