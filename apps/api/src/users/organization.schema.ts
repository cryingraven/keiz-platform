import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { NearNetwork } from '../common/network';

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true, index: true })
  slug: string;

  @Prop({ default: 'USD' })
  baseCurrency: string;

  /** The chain this workspace belongs to. Matches every member's network. */
  @Prop({ enum: ['mainnet', 'testnet'], index: true })
  network?: NearNetwork;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
