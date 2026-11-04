import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema({ timestamps: true, collection: 'customers' })
export class Customer {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop()
  taxId?: string;

  @Prop()
  billingAddress?: string;

  @Prop({ default: 'ACTIVE', enum: ['ACTIVE', 'ARCHIVED'] })
  status: string;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
CustomerSchema.index({ orgId: 1, createdAt: -1 });
