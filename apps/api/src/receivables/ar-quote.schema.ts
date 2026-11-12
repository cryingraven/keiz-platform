import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ArQuoteStatus =
  | 'AWAITING_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REFUNDED'
  | 'UNDERPAID'
  | 'NEEDS_REVIEW'
  | 'OVERPAID'
  | 'EXPIRED';

export type ArQuoteMode = 'CONTRACT' | 'TREASURY';

export type ArQuoteSource = 'DASHBOARD' | 'SHARE';

export type ArCollectionQuoteDocument = HydratedDocument<ArCollectionQuote>;

/**
 * A 1Click quote created for one receivable. Contract-mode receipts are still
 * recorded by the collect indexer; treasury-mode quotes are reconciled by
 * polling their unique deposit address.
 */
@Schema({ timestamps: true, collection: 'ar_collection_quotes' })
export class ArCollectionQuote {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, index: true })
  receivableId: string;

  @Prop({ required: true })
  receivableNumber: string;

  @Prop({ required: true, enum: ['CONTRACT', 'TREASURY'] })
  mode: ArQuoteMode;

  @Prop({ required: true, enum: ['DASHBOARD', 'SHARE'], default: 'DASHBOARD' })
  source: ArQuoteSource;

  /** Contract id in CONTRACT mode, treasury account in TREASURY mode. */
  @Prop({ required: true })
  destinationAddress: string;

  @Prop({ required: true })
  destinationAssetId: string;

  @Prop({ required: true })
  decimals: number;

  @Prop({ required: true })
  originAsset: string;

  @Prop({ required: true })
  refundTo: string;

  @Prop({ required: true, index: true })
  depositAddress: string;

  @Prop()
  depositMemo?: string;

  @Prop()
  correlationId?: string;

  /** Destination token amount in minor units. */
  @Prop({ required: true })
  amount: string;

  @Prop()
  amountFormatted?: string;

  /** Origin deposit amount in minor units, as quoted by 1Click. */
  @Prop()
  amountIn?: string;

  @Prop()
  amountInFormatted?: string;

  @Prop()
  originSymbol?: string;

  @Prop()
  destinationSymbol?: string;

  @Prop()
  originChain?: string;

  @Prop()
  destinationChain?: string;

  @Prop({ required: true, default: 'AWAITING_DEPOSIT' })
  status: ArQuoteStatus;

  @Prop({ type: Date })
  deadline?: Date;

  @Prop({ type: [String], default: [] })
  originTxHashes: string[];

  @Prop({ type: [String], default: [] })
  destinationTxHashes: string[];

  @Prop()
  refundReason?: string;

  @Prop()
  error?: string;

  @Prop()
  appliedReceiptId?: string;

  @Prop({ type: Date })
  appliedAt?: Date;

  @Prop({ required: true })
  createdByUserId: string;

  @Prop({ type: Date })
  expiredAt?: Date;
}

export const ArCollectionQuoteSchema =
  SchemaFactory.createForClass(ArCollectionQuote);

ArCollectionQuoteSchema.index(
  { depositAddress: 1 },
  { unique: true, partialFilterExpression: { depositAddress: { $exists: true } } },
);
ArCollectionQuoteSchema.index({ orgId: 1, status: 1, createdAt: 1 });
ArCollectionQuoteSchema.index({ receivableId: 1, createdAt: -1 });
