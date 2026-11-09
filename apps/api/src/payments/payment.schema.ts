import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { PaymentStatus } from '@keiz/shared';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ _id: false })
export class TxHashRef {
  @Prop({ required: true })
  hash: string;

  @Prop()
  explorerUrl?: string;
}
export const TxHashRefSchema = SchemaFactory.createForClass(TxHashRef);

@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, index: true })
  invoiceId: string;

  @Prop({ required: true, enum: ['mock', 'intents', 'outlayer'] })
  provider: 'mock' | 'intents' | 'outlayer';

  @Prop({ required: true, enum: ['USER', 'AGENT'], default: 'USER' })
  payer: 'USER' | 'AGENT';

  @Prop({ required: true })
  status: PaymentStatus;

  @Prop()
  rawStatus?: string;

  @Prop({ required: true })
  originAsset: string;

  @Prop({ required: true })
  destinationAsset: string;

  @Prop({ required: true })
  swapType: 'EXACT_INPUT' | 'EXACT_OUTPUT';

  @Prop({ required: true })
  amountIn: string;

  @Prop({ required: true })
  amountOut: string;

  @Prop()
  amountInFormatted?: string;

  @Prop()
  amountOutFormatted?: string;

  @Prop()
  minAmountOut?: string;

  @Prop()
  minAmountIn?: string;

  @Prop()
  maxAmountIn?: string;

  /** NEP-141 contract parsed from originAsset, used to verify the deposit tx. */
  @Prop()
  originContract?: string;

  @Prop()
  idempotencyKey?: string;

  @Prop()
  outlayerRequestId?: string;

  @Prop()
  originSymbol?: string;

  @Prop()
  destinationSymbol?: string;

  @Prop()
  destinationChain?: string;

  @Prop()
  destinationAddress?: string;

  @Prop()
  correlationId?: string;

  @Prop({ index: true })
  depositAddress?: string;

  @Prop()
  depositMemo?: string;

  @Prop({ type: Date })
  deadline?: Date;

  @Prop()
  txHash?: string;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: [TxHashRefSchema], default: [] })
  originTxHashes: TxHashRef[];

  @Prop({ type: [TxHashRefSchema], default: [] })
  destinationTxHashes: TxHashRef[];

  @Prop()
  refundReason?: string;

  @Prop()
  error?: string;

  @Prop()
  createdByUserId: string;

  /** NEAR account that paid (used by the chain indexer as sender_account_id). */
  @Prop()
  payerAccountId?: string;

  @Prop()
  agentActionId?: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ orgId: 1, createdAt: -1 });
PaymentSchema.index({ status: 1, deadline: 1 });
PaymentSchema.index({ provider: 1, status: 1 });
PaymentSchema.index({ provider: 1, submittedAt: -1 });
// A deposit transaction may fund at most one payment in an org.
PaymentSchema.index(
  { orgId: 1, txHash: 1 },
  { unique: true, partialFilterExpression: { txHash: { $exists: true } } },
);
PaymentSchema.index(
  { orgId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } },
);
// At most one live quote per invoice. This is enforced by the database, not just the service.
PaymentSchema.index(
  { orgId: 1, invoiceId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['AWAITING_DEPOSIT', 'PROCESSING'] } },
  },
);
