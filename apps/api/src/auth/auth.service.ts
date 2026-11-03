import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { LoginVerifyInput } from '@keiz/shared';
import { UsersService } from '../users/users.service';
import { AuthChallenge, AuthChallengeDocument } from './auth-challenge.schema';
import { NearVerifyService } from './near-verify.service';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
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
    return this.config.get<string>('APP_DOMAIN') ?? 'localhost';
  }

  async createChallenge(accountId: string, network: 'mainnet' | 'testnet' = 'mainnet') {
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
      expiresAt: expiresAt.toISOString(),
    };
  }

  async verify(input: LoginVerifyInput) {
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

    // Atomic single-use claim: two parallel requests cannot both succeed.
    const claimed = await this.challenges.updateOne(
      { _id: challenge._id, used: false },
      { $set: { used: true } },
    );
    if (claimed.modifiedCount !== 1) {
      throw new UnauthorizedException('Challenge already used');
    }

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
      throw new UnauthorizedException((error as Error).message);
    }

    const { user, org, membership } = await this.users.bootstrap(input.accountId);
    const refreshJti = randomUUID();
    await this.users.setRefreshJti(user.id, refreshJti);
    const tokens = await this.issueTokens(
      {
        sub: user.id,
        accountId: user.accountId,
        orgId: org!.id,
        role: membership!.role,
      },
      user.tokenVersion ?? 0,
      refreshJti,
    );

    return {
      ...tokens,
      user: { id: user.id, accountId: user.accountId, displayName: user.displayName ?? null },
      org: { id: org!.id, name: org!.name, slug: org!.slug },
      role: membership!.role,
    };
  }

  async issueTokens(
    payload: { sub: string; accountId: string; orgId: string; role: string },
    tokenVersion: number,
    refreshJti: string,
  ): Promise<SessionTokens> {
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    const accessToken = await this.jwt.signAsync(
      { ...payload, type: 'access', ver: tokenVersion },
      { secret, expiresIn: this.config.get('JWT_ACCESS_TTL') ?? '900s' },
    );
    const refreshToken = await this.jwt.signAsync(
      { ...payload, type: 'refresh', ver: tokenVersion, jti: refreshJti },
      { secret, expiresIn: this.config.get('JWT_REFRESH_TTL') ?? '7d' },
    );
    return { accessToken, refreshToken };
  }

  /** Returns a session or null - never throws, so the landing page has no 401 noise. */
  async session(token: string | undefined) {
    const empty = { user: null, org: null, role: null };
    if (!token) return empty;
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      if (payload.type !== 'access') return empty;
      const { user, org, membership } = await this.users.profile(payload.sub);
      if (!user || !org || !membership) return empty;
      if ((payload.ver ?? 0) !== (user.tokenVersion ?? 0)) return empty;
      return {
        user: {
          id: user.id,
          accountId: user.accountId,
          displayName: user.displayName ?? null,
        },
        org: { id: org.id, name: org.name, slug: org.slug },
        role: membership.role,
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

      if (!payload.jti || authUser.refreshJti !== payload.jti) {
        // A validly signed refresh token that is no longer current means reuse.
        await this.users.revokeAllSessions(payload.sub);
        throw new Error('refresh token reuse detected');
      }

      const nextJti = randomUUID();
      const rotated = await this.users.rotateRefresh(authUser.id, payload.jti, nextJti);
      if (!rotated) {
        await this.users.revokeAllSessions(payload.sub);
        throw new Error('refresh rotation lost');
      }

      const { org, membership } = await this.users.profile(authUser.id);
      if (!org || !membership) throw new Error('session subject missing');

      return this.issueTokens(
        {
          sub: authUser.id,
          accountId: authUser.accountId,
          orgId: org.id,
          role: membership.role,
        },
        authUser.tokenVersion ?? 0,
        nextJti,
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
