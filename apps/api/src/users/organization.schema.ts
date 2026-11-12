import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { BASE_CURRENCY } from '@keiz/shared';
import type { NearNetwork } from '../common/network';

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({ _id: false })
export class OrganizationCollection {
  @Prop({ required: true })
  contractId: string;

  @Prop({ required: true, enum: ['mainnet', 'testnet'] })
  network: NearNetwork;

  @Prop({ required: true })
  treasury: string;

  @Prop({ required: true })
  assetId: string;

  @Prop({ required: true })
  tokenContract: string;

  @Prop({ required: true, default: 6 })
  decimals: number;

  @Prop({
    required: true,
    enum: ['PENDING', 'ACTIVE', 'PAUSED', 'DISABLED'],
    default: 'PENDING',
  })
  status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'DISABLED';

  @Prop({ type: Date })
  deployedAt?: Date;

  @Prop({ type: Date })
  validatedAt?: Date;
}
export const OrganizationCollectionSchema = SchemaFactory.createForClass(OrganizationCollection);

@Schema({ _id: false })
export class OrganizationPaymentSettings {
  /** Optional: derived from the contract/treasury when omitted. */
  @Prop({ enum: ['CONTRACT', 'TREASURY', 'OFF'] })
  arMode?: 'CONTRACT' | 'TREASURY' | 'OFF';

  /** Plain NEAR account that receives AR in TREASURY mode. */
  @Prop()
  treasuryAccountId?: string;

  /** 1Click asset id delivered to the treasury (defaults to NEAR USDC). */
  @Prop()
  arAssetId?: string;
}
export const OrganizationPaymentSettingsSchema = SchemaFactory.createForClass(
  OrganizationPaymentSettings,
);

@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true, index: true })
  slug: string;

  @Prop({ default: BASE_CURRENCY, enum: [BASE_CURRENCY] })
  baseCurrency: string;

  /** The chain this workspace belongs to. Matches every member's network. */
  @Prop({ enum: ['mainnet', 'testnet'], index: true })
  network?: NearNetwork;

  /** Per-workspace on-chain AR collection contract. */
  @Prop({ type: OrganizationCollectionSchema })
  collection?: OrganizationCollection;

  /** Optional AR rail: contract, plain treasury, or off. */
  @Prop({ type: OrganizationPaymentSettingsSchema })
  paymentSettings?: OrganizationPaymentSettings;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
OrganizationSchema.index(
  { 'collection.contractId': 1 },
  { unique: true, partialFilterExpression: { 'collection.contractId': { $exists: true } } },
);
