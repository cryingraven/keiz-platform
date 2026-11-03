import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { InvoiceStatus } from '@keiz/shared';

export type InvoiceDocument = HydratedDocument<Invoice>;

@Schema({ _id: false })
export class InvoiceLine {
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
export const InvoiceLineSchema = SchemaFactory.createForClass(InvoiceLine);

@Schema({ _id: false })
export class InvoiceApproval {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  accountId: string;

  @Prop({ required: true, enum: ['APPROVE', 'REJECT'] })
  decision: 'APPROVE' | 'REJECT';

  @Prop()
  comment?: string;

  @Prop({ type: Date, required: true })
  at: Date;
}
export const InvoiceApprovalSchema = SchemaFactory.createForClass(InvoiceApproval);

@Schema({ timestamps: true, collection: 'invoices' })
export class Invoice {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, index: true })
  vendorId: string;

  @Prop({ required: true })
  number: string;

  @Prop({ required: true, type: Date })
  issueDate: Date;

  @Prop({ required: true, type: Date })
  dueDate: Date;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  /** Minor units for the currency (2 for USD) - UI divides by 10^decimals. */
  @Prop({ required: true, default: 2 })
  decimals: number;

  @Prop({ type: [InvoiceLineSchema], required: true })
  lineItems: InvoiceLine[];

  @Prop({ required: true })
  subtotal: string;

  @Prop({ required: true, default: 0 })
  taxBps: number;

  @Prop({ required: true })
  taxAmount: string;

  @Prop({ required: true })
  total: string;

  @Prop({ required: true, enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAYMENT_PENDING', 'PAID', 'VOID'], default: 'DRAFT' })
  status: InvoiceStatus;

  @Prop()
  notes?: string;

  @Prop({ required: true })
  createdByUserId: string;

  @Prop({ type: [InvoiceApprovalSchema], default: [] })
  approvals: InvoiceApproval[];

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop()
  paymentId?: string;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ orgId: 1, number: 1 }, { unique: true });
InvoiceSchema.index({ orgId: 1, createdAt: -1 });
InvoiceSchema.index({ orgId: 1, status: 1 });
