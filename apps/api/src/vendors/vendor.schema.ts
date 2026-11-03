import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type VendorDocument = HydratedDocument<Vendor>;

@Schema({ timestamps: true, collection: 'vendors' })
export class Vendor {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop()
  nearAccountId?: string;

  @Prop({ default: 'near' })
  payoutChain: string;

  @Prop({ required: true })
  payoutAddress: string;

  @Prop()
  bankName?: string;

  @Prop()
  bankAccount?: string;

  @Prop({ default: 'ACTIVE', enum: ['ACTIVE', 'ARCHIVED'] })
  status: string;
}

export const VendorSchema = SchemaFactory.createForClass(Vendor);
VendorSchema.index({ orgId: 1, createdAt: -1 });
