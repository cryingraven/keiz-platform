import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WebAuthnCredentialDocument = HydratedDocument<WebAuthnCredential>;

export interface WrappedSeed {
  v: 1;
  nonce: string;
  ciphertext: string;
}

/**
 * A passkey bound to one KEIZ user and one derived NEAR key.
 *
 * `webauthnPublicKey` is the authenticator's P-256 credential public key and is
 * only used to verify assertions. `nearPublicKey` is the independent ed25519 key
 * derived from the user's seed; the seed itself is never stored, only a
 * per-credential AES-GCM wrap that requires the WebAuthn PRF output to open.
 */
@Schema({ timestamps: true, collection: 'webauthn_credentials' })
export class WebAuthnCredential {
  /** WebAuthn credential ID (base64url). */
  @Prop({ required: true, unique: true, index: true })
  credentialId: string;

  @Prop({ required: true, index: true })
  userId: string;

  /** Implicit hex account for passkey-only users, or the named wallet account. */
  @Prop({ required: true, index: true })
  accountId: string;

  /** COSE credential public key used by SimpleWebAuthn. */
  @Prop({ required: true, type: Buffer })
  webauthnPublicKey: Buffer;

  /** ed25519:<base58> public key derived from the wrapped seed. */
  @Prop({ required: true })
  nearPublicKey: string;

  @Prop({ default: 0 })
  counter: number;

  @Prop({ type: [String], default: [] })
  transports: string[];

  @Prop()
  deviceType?: string;

  @Prop({ default: false })
  backedUp: boolean;

  @Prop()
  aaguid?: string;

  @Prop({ required: true, type: Object })
  wrappedSeed: WrappedSeed;

  @Prop()
  lastUsedAt?: Date;
}

export const WebAuthnCredentialSchema = SchemaFactory.createForClass(WebAuthnCredential);
