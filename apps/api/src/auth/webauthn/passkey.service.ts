import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import type {
  PasskeySignupVerifyInput,
  PasskeyCredentialVerifyInput,
  LoginVerifyInput,
} from '@keiz/shared';
import { walletNetwork } from '../../common/network';
import { UsersService } from '../../users/users.service';
import { AuthService, CompletedLogin } from '../auth.service';
import { decodePublicKey } from '../nep413';
import { NearRpcError, NearVerifyService } from '../near-verify.service';
import {
  WebAuthnChallenge,
  WebAuthnChallengeDocument,
} from './webauthn-challenge.schema';
import { WebAuthnCredential, WebAuthnCredentialDocument } from './webauthn-credential.schema';
import { WebAuthnConfig, webauthnConfig } from './webauthn.config';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const HEX_IMPLICIT = /^[0-9a-f]{64}$/i;
const MAX_CREDENTIALS = 10;

interface PasskeyCredentialInput {
  id: string;
  rawId: string;
  type: 'public-key';
  response: Record<string, unknown>;
  clientExtensionResults?: Record<string, unknown>;
  authenticatorAttachment?: string;
}

@Injectable()
export class PasskeyService {
  private readonly rp: WebAuthnConfig;

  constructor(
    @InjectModel(WebAuthnCredential.name)
    private readonly credentials: Model<WebAuthnCredentialDocument>,
    @InjectModel(WebAuthnChallenge.name)
    private readonly challenges: Model<WebAuthnChallengeDocument>,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly near: NearVerifyService,
    private readonly config: ConfigService,
  ) {
    this.rp = webauthnConfig(config);
  }

  private get network() {
    return walletNetwork(this.config);
  }

  // ---------------------------------------------------------------- helpers

  /** The PRF output must never reach the server: it unlocks the wrapped seed. */
  private assertNoPrf(credential: PasskeyCredentialInput): void {
    const stack: unknown[] = [credential];
    while (stack.length > 0) {
      const value = stack.pop();
      if (!value || typeof value !== 'object') continue;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (key.toLowerCase() === 'prf') {
          throw new BadRequestException(
            'PRF extension results must stay in the browser and must not be sent to the API.',
          );
        }
        if (child && typeof child === 'object') stack.push(child);
      }
    }
  }

  private assertNearPublicKey(accountId: string, nearPublicKey: string): void {
    let bytes: Buffer;
    try {
      bytes = decodePublicKey(nearPublicKey);
    } catch {
      throw new BadRequestException('nearPublicKey must be an ed25519 public key');
    }
    if (HEX_IMPLICIT.test(accountId) && bytes.toString('hex').toLowerCase() !== accountId.toLowerCase()) {
      throw new BadRequestException('The implicit NEAR account does not match the provided key');
    }
  }

  private async rememberChallenge(
    challenge: string,
    kind: 'registration' | 'authentication',
    userId?: string,
  ): Promise<void> {
    await this.challenges.create({
      challenge,
      kind,
      userId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
  }

  private async lookupChallenge(
    challenge: string,
    kind: 'registration' | 'authentication',
    userId?: string,
  ): Promise<WebAuthnChallengeDocument> {
    const doc = await this.challenges.findOne({ challenge, kind, used: false });
    if (!doc) throw new UnauthorizedException('Unknown or expired passkey challenge');
    if (doc.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Passkey challenge expired');
    }
    if (userId && doc.userId && doc.userId !== userId) {
      throw new UnauthorizedException('Passkey challenge belongs to another user');
    }
    return doc;
  }

  private async claimChallenge(doc: WebAuthnChallengeDocument): Promise<void> {
    const claimed = await this.challenges.updateOne(
      { _id: doc._id, used: false },
      { $set: { used: true } },
    );
    if (claimed.modifiedCount !== 1) {
      throw new UnauthorizedException('Passkey challenge already used');
    }
  }

  private registrationOptions(userName: string, excludeIds: string[] = []) {
    return generateRegistrationOptions({
      rpName: this.rp.rpName,
      rpID: this.rp.rpId,
      userName: userName.slice(0, 64),
      userDisplayName: userName.slice(0, 64),
      userID: createHash('sha256')
        .update(`keiz:passkey-user:v1:${userName}`)
        .digest()
        .subarray(0, 32),
      attestationType: 'none',
      excludeCredentials: excludeIds.map((id) => ({ id })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });
  }

  private async verifyRegistration(
    challenge: WebAuthnChallengeDocument,
    credential: PasskeyCredentialInput,
    userId?: string,
  ) {
    const verified = await verifyRegistrationResponse({
      response: credential as unknown as RegistrationResponseJSON,
      expectedChallenge: async (value) => {
        const found = await this.lookupChallenge(value, 'registration', userId);
        return found._id.toString() === challenge._id.toString();
      },
      expectedOrigin: this.rp.origins,
      expectedRPID: this.rp.rpId,
      requireUserPresence: true,
      requireUserVerification: true,
    });
    if (!verified.verified || !verified.registrationInfo) {
      throw new UnauthorizedException('Passkey registration could not be verified');
    }
    const info = verified.registrationInfo;
    await this.claimChallenge(challenge);
    return info;
  }

  // ----------------------------------------------------------------- signup

  async signupOptions(accountId: string, nearPublicKey: string) {
    if (!HEX_IMPLICIT.test(accountId)) {
      throw new BadRequestException(
        'Passkey signup only supports implicit NEAR accounts. Add a passkey to an existing wallet account from Settings.',
      );
    }
    this.assertNearPublicKey(accountId, nearPublicKey);
    const options = await this.registrationOptions(accountId);
    await this.rememberChallenge(options.challenge, 'registration', accountId);
    return { options };
  }

  async signupVerify(input: PasskeySignupVerifyInput): Promise<CompletedLogin> {
    this.assertNoPrf(input.credential as PasskeyCredentialInput);
    this.assertNearPublicKey(input.accountId, input.nearPublicKey);
    if (
      input.nep413.accountId !== input.accountId ||
      input.nep413.publicKey !== input.nearPublicKey
    ) {
      throw new BadRequestException('The NEP-413 proof does not match this passkey account');
    }

    // Prove control of the derived NEAR key before binding a passkey to it.
    // Without this, anyone could claim an arbitrary implicit account id.
    await this.auth.verifyNep413Only(input.nep413 as LoginVerifyInput);

    const challenge = await this.lookupChallenge(
      this.challengeFromResponse(input.credential as PasskeyCredentialInput),
      'registration',
      input.accountId,
    );
    const info = await this.verifyRegistration(
      challenge,
      input.credential as PasskeyCredentialInput,
      input.accountId,
    );

    // Create the user row first so the credential has an owner. `ensureUser`
    // does not create a workspace; `completeLogin` does that after the
    // credential is safely stored.
    const user = await this.users.ensureUser(input.accountId, this.network);
    await this.storeCredential(
      {
        accountId: input.accountId,
        userId: user.id,
        nearPublicKey: input.nearPublicKey,
        wrappedSeed: input.wrappedSeed,
      },
      info,
      info.credential.id,
    );

    return this.auth.completeLogin(input.accountId, this.network, 'passkey');
  }

  // ------------------------------------------------------------- login flow

  async loginOptions() {
    const options = await generateAuthenticationOptions({
      rpID: this.rp.rpId,
      allowCredentials: [],
      userVerification: 'required',
    });
    await this.rememberChallenge(options.challenge, 'authentication');
    return { options };
  }

  async loginVerify(credential: PasskeyCredentialInput, accountId?: string) {
    this.assertNoPrf(credential);
    const stored = await this.credentials.findOne({ credentialId: credential.id });
    if (!stored) throw new UnauthorizedException('Passkey sign-in failed');
    if (accountId && accountId !== stored.accountId) {
      throw new UnauthorizedException('Passkey sign-in failed');
    }

    const challenge = await this.lookupChallenge(
      this.challengeFromResponse(credential),
      'authentication',
    );
    const verified = await verifyAuthenticationResponse({
      response: credential as unknown as AuthenticationResponseJSON,
      expectedChallenge: async (value) => value === challenge.challenge,
      expectedOrigin: this.rp.origins,
      expectedRPID: this.rp.rpId,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.webauthnPublicKey),
        counter: stored.counter,
        transports: stored.transports as never,
      },
      requireUserVerification: true,
    });
    if (!verified.verified) throw new UnauthorizedException('Passkey sign-in failed');
    await this.claimChallenge(challenge);

    const user = await this.users.authState(stored.userId);
    if (!user || user.accountId !== stored.accountId) {
      throw new UnauthorizedException('Passkey sign-in failed');
    }

    // The passkey-derived key must still be a full-access key on the account.
    // Implicit accounts report UNKNOWN_ACCOUNT before they are funded, which
    // `assertFullAccessKey` accepts only when the id is the key's hex.
    try {
      await this.near.assertFullAccessKey(
        stored.accountId,
        stored.nearPublicKey,
        this.network,
      );
    } catch (error) {
      if (error instanceof NearRpcError) {
        throw new ServiceUnavailableException(
          'NEAR is temporarily unavailable. Please try signing in again.',
        );
      }
      throw new UnauthorizedException('Passkey sign-in failed');
    }

    await this.credentials.updateOne(
      { _id: stored._id },
      {
        $set: {
          counter: verified.authenticationInfo.newCounter,
          lastUsedAt: new Date(),
          deviceType: verified.authenticationInfo.credentialDeviceType,
          backedUp: verified.authenticationInfo.credentialBackedUp,
        },
      },
    );

    return this.auth.completeLogin(stored.accountId, this.network, 'passkey');
  }

  /** Recovery-key login uses the existing NEP-413 proof but marks the session. */
  recoveryVerify(input: LoginVerifyInput): Promise<CompletedLogin> {
    return this.auth.verifyRecovery(input);
  }

  // ---------------------------------------------------------- add / manage

  async credentialOptions(userId: string, accountId: string, nearPublicKey: string) {
    const existing = await this.credentials.find({ userId }).select('credentialId nearPublicKey');
    if (existing.length >= MAX_CREDENTIALS) {
      throw new BadRequestException('Too many passkeys on this account');
    }
    if (existing.length > 0) {
      const bound = existing[0].nearPublicKey;
      if (bound !== nearPublicKey) {
        throw new BadRequestException(
          'A second passkey must wrap the same NEAR key as the existing passkey.',
        );
      }
    } else if (accountId !== this.hexFromPublicKey(nearPublicKey)) {
      // Named wallet account: the derived key must already be a full-access
      // on-chain key, added by the wallet (Phase 2 AddKey flow).
      await this.assertOnChainKey(accountId, nearPublicKey);
    }

    const options = await this.registrationOptions(
      accountId,
      existing.map((credential) => credential.credentialId),
    );
    await this.rememberChallenge(options.challenge, 'registration', userId);
    return { options };
  }

  async addCredential(userId: string, input: PasskeyCredentialVerifyInput) {
    this.assertNoPrf(input.credential as PasskeyCredentialInput);
    const user = await this.users.authState(userId);
    if (!user) throw new UnauthorizedException('Session expired');
    this.assertNearPublicKey(user.accountId, input.nearPublicKey);

    const existing = await this.credentials.find({ userId }).select('nearPublicKey');
    if (existing.length >= MAX_CREDENTIALS) {
      throw new BadRequestException('Too many passkeys on this account');
    }
    if (existing.length > 0 && existing[0].nearPublicKey !== input.nearPublicKey) {
      throw new BadRequestException(
        'A second passkey must wrap the same NEAR key as the existing passkey.',
      );
    }
    if (existing.length === 0 && user.accountId !== this.hexFromPublicKey(input.nearPublicKey)) {
      await this.assertOnChainKey(user.accountId, input.nearPublicKey);
    }
    if (
      input.nep413.accountId !== user.accountId ||
      input.nep413.publicKey !== input.nearPublicKey
    ) {
      throw new BadRequestException('The NEP-413 proof does not match this passkey account');
    }
    // Prove ownership of the seed before granting another login credential.
    // A stolen session alone must not be able to enroll a permanent passkey.
    await this.auth.verifyNep413Only(input.nep413 as LoginVerifyInput);

    const challenge = await this.lookupChallenge(
      this.challengeFromResponse(input.credential as PasskeyCredentialInput),
      'registration',
      userId,
    );
    const info = await this.verifyRegistration(
      challenge,
      input.credential as PasskeyCredentialInput,
      userId,
    );
    await this.storeCredential(
      {
        accountId: user.accountId,
        userId,
        nearPublicKey: input.nearPublicKey,
        wrappedSeed: input.wrappedSeed,
      },
      info,
      info.credential.id,
    );
    return { ok: true };
  }

  private hexFromPublicKey(nearPublicKey: string): string {
    return decodePublicKey(nearPublicKey).toString('hex');
  }

  /**
   * The wallet's AddKey transaction may still be finalizing when the browser
   * immediately asks for registration options. Retry briefly before rejecting.
   */
  private async assertOnChainKey(accountId: string, nearPublicKey: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await this.near.assertFullAccessKey(accountId, nearPublicKey, this.network);
        return;
      } catch (error) {
        lastError = error;
        if (error instanceof NearRpcError) {
          throw new ServiceUnavailableException(
            'NEAR is temporarily unavailable. Try adding the passkey again.',
          );
        }
        if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    void lastError;
    throw new BadRequestException(
      'The passkey-derived key is not a full-access key on this account. Add it on-chain first.',
    );
  }

  private challengeFromResponse(credential: PasskeyCredentialInput): string {
    const clientData = credential.response?.clientDataJSON;
    if (typeof clientData !== 'string') {
      throw new BadRequestException('WebAuthn response is missing clientDataJSON');
    }
    try {
      const parsed = JSON.parse(
        Buffer.from(clientData.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
      ) as { challenge?: unknown };
      if (typeof parsed.challenge !== 'string') throw new Error('missing challenge');
      return parsed.challenge;
    } catch {
      throw new BadRequestException('WebAuthn clientDataJSON is invalid');
    }
  }

  private async storeCredential(
    metadata: {
      accountId: string;
      userId: string;
      nearPublicKey: string;
      wrappedSeed: { v: 1; nonce: string; ciphertext: string };
    },
    info: {
      credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] };
      credentialDeviceType: string;
      credentialBackedUp: boolean;
      aaguid: string;
    },
    credentialId: string,
  ): Promise<void> {
    const duplicate = await this.credentials.findOne({ credentialId });
    if (duplicate) throw new ConflictException('This passkey is already registered');
    try {
      await this.credentials.create({
        credentialId,
        userId: metadata.userId,
        accountId: metadata.accountId,
        webauthnPublicKey: Buffer.from(info.credential.publicKey),
        nearPublicKey: metadata.nearPublicKey,
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        aaguid: info.aaguid,
        wrappedSeed: metadata.wrappedSeed,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('This passkey is already registered');
      }
      throw error;
    }
  }

  async listCredentials(userId: string) {
    const credentials = await this.credentials
      .find({ userId })
      .sort({ createdAt: 1 })
      .lean();
    return credentials.map((credential) => ({
      id: String(credential._id),
      credentialId: credential.credentialId,
      accountId: credential.accountId,
      nearPublicKey: credential.nearPublicKey,
      deviceType: credential.deviceType ?? null,
      backedUp: Boolean(credential.backedUp),
      lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
      createdAt: (credential as { createdAt?: Date }).createdAt?.toISOString() ?? null,
    }));
  }

  async removeCredential(userId: string, id: string, confirmRecovery: boolean) {
    if (!/^[a-f0-9]{24}$/i.test(id)) throw new NotFoundException('Passkey not found');
    const credential = await this.credentials.findOne({ _id: id, userId });
    if (!credential) throw new NotFoundException('Passkey not found');
    const count = await this.credentials.countDocuments({ userId });
    if (count <= 1 && !confirmRecovery) {
      throw new BadRequestException(
        'This is your last passkey. Export your recovery key first, then confirm removal.',
      );
    }
    await this.credentials.deleteOne({ _id: credential._id, userId });
    return { ok: true };
  }

  async unlock(userId: string, credentialId: string) {
    const credential = await this.credentials.findOne({ credentialId, userId });
    if (!credential) throw new NotFoundException('Passkey not found');
    return {
      credentialId: credential.credentialId,
      accountId: credential.accountId,
      nearPublicKey: credential.nearPublicKey,
      wrappedSeed: credential.wrappedSeed,
    };
  }
}
