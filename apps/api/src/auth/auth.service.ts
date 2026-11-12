import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { BASE_CURRENCY, LoginVerifyInput } from '@keiz/shared';
import type { AuthMethod } from '../common/current-user.decorator';
import { NearNetwork, walletNetwork } from '../common/network';
import { UsersService } from '../users/users.service';
import { AuthChallenge, AuthChallengeDocument } from './auth-challenge.schema';
import { NearVerifyService, NearRpcError } from './near-verify.service';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface CompletedLogin {
  accessToken: string;
  refreshToken: string;
  user: { id: string; accountId: string; displayName: string | null };
  org: { id: string; name: string; slug: string; baseCurrency: string };
  role: string;
  authMethod: AuthMethod;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(AuthChallenge.name)
    private readonly challenges: Model<AuthChallengeDocument>,
    private readonly users: UsersService,
    private readonly near: NearVerifyService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get domain(): string {
    return this.config.get<string>('APP_DOMAIN') || 'localhost';
  }

  private get network(): NearNetwork {
    return walletNetwork(this.config);
  }

  async createChallenge(accountId: string, network: NearNetwork) {
    const expected = this.network;
    if (network !== expected) {
      throw new BadRequestException(
        `This deployment only accepts NEAR ${expected} logins (received ${network}).`,
      );
    }
    const nonce = randomBytes(32);
    const recipient = this.domain;
    const message = [
      `${recipient} wants you to sign in with your NEAR account:`,
      accountId,
      '',
      'Statement: Authenticate to KEIZ.',
      'This request will not trigger a blockchain transaction or cost any gas.',
    ].join('\n');

    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    await this.challenges.create({
      nonce: nonce.toString('base64'),
      accountId,
      message,
      recipient,
      network,
      expiresAt,
    });

    return {
      nonce: nonce.toString('base64'),
      message,
      recipient,
      network,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Verifies a NEP-413 payload and atomically claims its challenge. The caller
   * decides what to do next: `verify()` issues a wallet session, while passkey
   * signup uses this to prove ownership of the derived NEAR key.
   */
  async claimNep413(input: LoginVerifyInput): Promise<AuthChallengeDocument> {
    const challenge = await this.challenges.findOne({
      nonce: input.nonce,
      accountId: input.accountId,
    });
    if (!challenge) throw new UnauthorizedException('Unknown or expired challenge');
    if (challenge.used) throw new UnauthorizedException('Challenge already used');
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Challenge expired');
    }
    if (challenge.recipient !== input.recipient) {
      throw new UnauthorizedException('Challenge domain mismatch');
    }
    if (challenge.network !== this.network) {
      throw new UnauthorizedException('Challenge network does not match this deployment');
    }

    // Verify first, then claim: an RPC blip should not burn the nonce and force
    // the user to restart the whole sign-in flow.
    try {
      await this.near.verify({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: Buffer.from(challenge.nonce, 'base64'),
        signature: input.signature,
        publicKey: input.publicKey,
      });
      await this.near.assertFullAccessKey(input.accountId, input.publicKey, challenge.network);
    } catch (error) {
      if (error instanceof NearRpcError) {
        throw new ServiceUnavailableException(
          'NEAR is temporarily unavailable. Please try signing in again.',
        );
      }
      throw new UnauthorizedException((error as Error).message);
    }

    // Atomic single-use claim: two parallel requests cannot both succeed.
    const claimed = await this.challenges.updateOne(
      { _id: challenge._id, used: false },
      { $set: { used: true } },
    );
    if (claimed.modifiedCount !== 1) {
      throw new UnauthorizedException('Challenge already used');
    }
    return challenge;
  }

  async verify(input: LoginVerifyInput): Promise<CompletedLogin> {
    const challenge = await this.claimNep413(input);
    return this.completeLogin(input.accountId, challenge.network, 'wallet');
  }

  /** Recovery-key login: same NEP-413 proof, but flagged so the UI signs locally. */
  async verifyRecovery(input: LoginVerifyInput): Promise<CompletedLogin> {
    const challenge = await this.claimNep413(input);
    return this.completeLogin(input.accountId, challenge.network, 'recovery');
  }

  /** Used by passkey signup: proves the derived NEAR key, without a session yet. */
  async verifyNep413Only(input: LoginVerifyInput): Promise<AuthChallengeDocument> {
    return this.claimNep413(input);
  }

  /** Bootstrap the user/workspace and issue the normal access + refresh cookies. */
  async completeLogin(
    accountId: string,
    network: NearNetwork,
    authMethod: AuthMethod,
  ): Promise<CompletedLogin> {
    const { user, org, membership } = await this.users.bootstrap(accountId, network);
    const refreshJti = randomUUID();
    await this.users.setRefreshJti(user.id, refreshJti);
    const tokens = await this.issueTokens(
      {
        sub: user.id,
        accountId: user.accountId,
        orgId: org!.id,
        role: membership!.role,
        network,
      },
      user.tokenVersion ?? 0,
      refreshJti,
      authMethod,
    );

    return {
      ...tokens,
      user: { id: user.id, accountId: user.accountId, displayName: user.displayName ?? null },
      org: {
        id: org!.id,
        name: org!.name,
        slug: org!.slug,
        baseCurrency: BASE_CURRENCY,
      },
      role: membership!.role,
      authMethod,
    };
  }

  async issueTokens(
    payload: {
      sub: string;
      accountId: string;
      orgId: string;
      role: string;
      network?: NearNetwork;
    },
    tokenVersion: number,
    refreshJti: string,
    authMethod: AuthMethod = 'wallet',
    authTime?: number,
  ): Promise<SessionTokens> {
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    const authenticatedAt = authTime ?? Math.floor(Date.now() / 1000);
    const accessToken = await this.jwt.signAsync(
      {
        ...payload,
        type: 'access',
        ver: tokenVersion,
        amr: authMethod,
        auth_time: authenticatedAt,
      },
      { secret, expiresIn: this.config.get('JWT_ACCESS_TTL') || '900s' },
    );
    const refreshToken = await this.jwt.signAsync(
      {
        ...payload,
        type: 'refresh',
        ver: tokenVersion,
        jti: refreshJti,
        amr: authMethod,
        auth_time: authenticatedAt,
      },
      { secret, expiresIn: this.config.get('JWT_REFRESH_TTL') || '7d' },
    );
    return { accessToken, refreshToken };
  }

  /** Returns a session or null - never throws, so the landing page has no 401 noise. */
  async session(token: string | undefined) {
    const empty = { user: null, org: null, role: null, authMethod: null };
    if (!token) return empty;
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      if (payload.type !== 'access') return empty;
      const { user, org, membership } = await this.users.profile(payload.sub);
      if (!user || !org || !membership) return empty;
      if ((payload.ver ?? 0) !== (user.tokenVersion ?? 0)) return empty;
      if (user.network && user.network !== this.network) return empty;
      if (payload.network && payload.network !== this.network) return empty;
      if (org.network && org.network !== this.network) return empty;
      return {
        user: {
          id: user.id,
          accountId: user.accountId,
          displayName: user.displayName ?? null,
        },
        org: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          baseCurrency: BASE_CURRENCY,
        },
        role: membership.role,
        authMethod: (payload.amr as AuthMethod | undefined) ?? 'wallet',
      };
    } catch {
      return empty;
    }
  }

  async refresh(token: string | undefined) {
    if (!token) throw new UnauthorizedException('Missing refresh token');
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      if (payload.type !== 'refresh') throw new Error('wrong token type');

      const authUser = await this.users.authState(payload.sub);
      if (!authUser) throw new Error('session subject missing');
      if ((payload.ver ?? 0) !== (authUser.tokenVersion ?? 0)) {
        throw new Error('token version revoked');
      }
      if (authUser.network && authUser.network !== this.network) {
        throw new Error('token network mismatch');
      }
      if (payload.network && payload.network !== this.network) {
        throw new Error('token network mismatch');
      }
      if (!payload.jti) throw new Error('refresh token has no jti');

      // The immediately previous jti is accepted for a short grace window.
      // Parallel tabs (or fan-out requests after a 401) race the rotation; the
      // loser must not revoke the whole token family. It reuses the current jti.
      const graceValid =
        authUser.previousRefreshJti === payload.jti &&
        authUser.refreshGraceUntil instanceof Date &&
        authUser.refreshGraceUntil.getTime() > Date.now();

      if (payload.jti !== authUser.refreshJti && !graceValid) {
        // A validly signed refresh token that is no longer current means reuse.
        await this.users.revokeAllSessions(payload.sub);
        throw new Error('refresh token reuse detected');
      }

      let activeJti = authUser.refreshJti;
      if (payload.jti === authUser.refreshJti) {
        const nextJti = randomUUID();
        const rotated = await this.users.rotateRefresh(authUser.id, payload.jti, nextJti);
        if (!rotated) {
          // Another request won the rotation; fall back to the current jti if it
          // is still our token's successor. Otherwise fail closed.
          const fresh = await this.users.authState(payload.sub);
          if (fresh && fresh.previousRefreshJti === payload.jti && fresh.refreshJti) {
            activeJti = fresh.refreshJti;
          } else {
            await this.users.revokeAllSessions(payload.sub);
            throw new Error('refresh rotation lost');
          }
        } else {
          activeJti = nextJti;
        }
      }

      if (!activeJti) throw new Error('refresh token state missing');

      const { org, membership } = await this.users.profile(authUser.id);
      if (!org || !membership) throw new Error('session subject missing');
      if (org.network && org.network !== this.network) {
        throw new Error('workspace network mismatch');
      }

      return this.issueTokens(
        {
          sub: authUser.id,
          accountId: authUser.accountId,
          orgId: org.id,
          role: membership.role,
          network: this.network,
        },
        authUser.tokenVersion ?? 0,
        activeJti,
        (payload.amr as AuthMethod | undefined) ?? 'wallet',
        typeof payload.auth_time === 'number' ? payload.auth_time : undefined,
      );
    } catch {
      throw new UnauthorizedException('Refresh token is invalid');
    }
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      if (payload.sub) await this.users.clearRefreshJti(payload.sub);
    } catch {
      // An invalid or expired token needs no revocation.
    }
  }
}
