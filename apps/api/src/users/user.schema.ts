import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { NearNetwork } from '../common/network';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, index: true })
  accountId: string;

  /** Which chain this identity was created on. Guards cross-network logins. */
  @Prop({ enum: ['mainnet', 'testnet'], index: true })
  network?: NearNetwork;

  @Prop()
  displayName?: string;

  @Prop()
  avatarUrl?: string;

  /** Workspace selected on the next sign-in. Null means "first membership". */
  @Prop()
  activeOrgId?: string;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  /** Bumped to invalidate every access and refresh token for this user. */
  @Prop({ default: 0 })
  tokenVersion: number;

  /** Current refresh-token id. Rotation replaces it; reuse triggers revocation. */
  @Prop({ select: false })
  refreshJti?: string;

  /**
   * The jti that was current immediately before this one. It is accepted for a
   * short grace window so parallel tabs cannot race each other into a logout.
   */
  @Prop({ select: false })
  previousRefreshJti?: string;

  @Prop({ type: Date, select: false })
  refreshGraceUntil?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
