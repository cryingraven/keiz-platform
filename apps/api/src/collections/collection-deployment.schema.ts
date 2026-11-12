import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { NearNetwork } from '../common/network';

export type CollectionDeploymentStatus =
  | 'QUEUED'
  | 'DEPLOYING'
  | 'ALLOWLISTING'
  | 'TRANSFERRING'
  | 'VERIFYING'
  | 'ACTIVE'
  | 'FAILED';

export interface CollectionDeployStep {
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  txHash?: string;
  error?: string;
  at?: Date;
}

const ACTIVE_STATUSES: CollectionDeploymentStatus[] = [
  'QUEUED',
  'DEPLOYING',
  'ALLOWLISTING',
  'TRANSFERRING',
  'VERIFYING',
];

export type CollectionDeploymentDocument = HydratedDocument<CollectionDeployment>;

/**
 * One-click deploy of a workspace `keiz-collect` contract. The contract is
 * created as a subaccount of the server deployer and ownership is transferred
 * to the requesting user once the token is allowlisted.
 */
@Schema({ timestamps: true, collection: 'collection_deployments' })
export class CollectionDeployment {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true })
  requestedByUserId: string;

  @Prop({ required: true })
  ownerAccountId: string;

  @Prop({
    required: true,
    default: 'QUEUED',
    enum: [
      'QUEUED',
      'DEPLOYING',
      'ALLOWLISTING',
      'TRANSFERRING',
      'VERIFYING',
      'ACTIVE',
      'FAILED',
    ],
  })
  status: CollectionDeploymentStatus;

  @Prop({ required: true, enum: ['mainnet', 'testnet'] })
  network: NearNetwork;

  @Prop({ required: true })
  contractId: string;

  @Prop({ required: true })
  treasury: string;

  @Prop({ required: true })
  assetId: string;

  @Prop({ required: true })
  tokenContract: string;

  @Prop({ required: true, default: 6 })
  decimals: number;

  @Prop({ type: Object, default: {} })
  steps: Record<string, CollectionDeployStep>;

  @Prop({ type: [String], default: [] })
  txHashes: string[];

  @Prop()
  error?: string;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  finishedAt?: Date;
}

export const CollectionDeploymentSchema =
  SchemaFactory.createForClass(CollectionDeployment);

CollectionDeploymentSchema.index({ orgId: 1, createdAt: -1 });
// One live deployment per workspace. The service still checks first; this is
// the database-level guard against two concurrent clicks.
CollectionDeploymentSchema.index(
  { orgId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ACTIVE_STATUSES } } },
);
