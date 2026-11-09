import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WebAuthnChallengeDocument = HydratedDocument<WebAuthnChallenge>;

/**
 * A WebAuthn ceremony challenge. It is looked up from the clientDataJSON
 * challenge during verification, then claimed atomically so it cannot be
 * replayed.
 */
@Schema({ timestamps: true, collection: 'webauthn_challenges' })
export class WebAuthnChallenge {
  /** base64url challenge, exactly as returned by SimpleWebAuthn. */
  @Prop({ required: true, unique: true, index: true })
  challenge: string;

  @Prop({ required: true, enum: ['registration', 'authentication'], index: true })
  kind: 'registration' | 'authentication';

  /** Set for registration ceremonies; absent for usernameless authentication. */
  @Prop()
  userId?: string;

  @Prop({ required: true, type: Date })
  expiresAt: Date;

  @Prop({ default: false })
  used: boolean;
}

export const WebAuthnChallengeSchema = SchemaFactory.createForClass(WebAuthnChallenge);
WebAuthnChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
