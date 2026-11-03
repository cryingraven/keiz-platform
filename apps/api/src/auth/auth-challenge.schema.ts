import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuthChallengeDocument = HydratedDocument<AuthChallenge>;

@Schema({ timestamps: true, collection: 'auth_challenges' })
export class AuthChallenge {
  /** base64-encoded 32-byte nonce - also the lookup key. */
  @Prop({ required: true, unique: true, index: true })
  nonce: string;

  @Prop({ required: true, index: true })
  accountId: string;

  @Prop({ required: true })
  message: string;

  @Prop({ required: true })
  recipient: string;

  @Prop({ required: true, enum: ['mainnet', 'testnet'], default: 'mainnet' })
  network: 'mainnet' | 'testnet';

  @Prop({ required: true, type: Date })
  expiresAt: Date;

  @Prop({ default: false })
  used: boolean;
}

export const AuthChallengeSchema = SchemaFactory.createForClass(AuthChallenge);
// Mongo TTL index: challenges disappear on their own, so a replay window is bounded.
AuthChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
