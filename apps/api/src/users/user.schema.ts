import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, index: true })
  accountId: string;

  @Prop()
  displayName?: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  /** Bumped to invalidate every access and refresh token for this user. */
  @Prop({ default: 0 })
  tokenVersion: number;

  /** Current refresh-token id. Rotation replaces it; reuse triggers revocation. */
  @Prop({ select: false })
  refreshJti?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
