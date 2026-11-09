import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Throttle } from '@nestjs/throttler';
import {
  loginChallengeSchema,
  loginVerifySchema,
  nearAuthRelaySchema,
  switchOrgSchema,
} from '@keiz/shared';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../common/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { ZodBody } from '../common/zod-body';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { NearAuthService } from './near-auth.service';

function cookieOptions() {
  const secure =
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === 'true'
      : process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly nearAuth: NearAuthService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('challenge')
  challenge(
    @Body(new ZodBody(loginChallengeSchema))
    body: { accountId: string; network: 'mainnet' | 'testnet' },
  ) {
    return this.auth.createChallenge(body.accountId, body.network);
  }

  /** Submits the NEAR Auth `sign` action on behalf of a logged-in Auth0 user. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('near-auth/relay')
  relay(
    @Body(new ZodBody(nearAuthRelaySchema))
    body: { receiverId: string; methodName: 'sign'; argsBase64: string; gas: string; deposit: string },
  ) {
    return this.nearAuth.relay(body);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  async verify(
    @Body(new ZodBody(loginVerifySchema))
    body: { accountId: string; publicKey: string; signature: string; nonce: string; recipient: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verify(body);
    res.cookie(ACCESS_COOKIE, result.accessToken, {
      ...cookieOptions(),
      maxAge: 15 * 60 * 1000,
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...cookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    const { accessToken, refreshToken, ...session } = result;
    void accessToken;
    void refreshToken;
    return session;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...cookieOptions(),
      maxAge: 15 * 60 * 1000,
    });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...cookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { ok: true };
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(ACCESS_COOKIE, cookieOptions());
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    return { ok: true };
  }

  @Get('orgs')
  orgs(@CurrentUser() user: AuthUser) {
    return this.users.listOrgs(user.sub);
  }

  @Post('switch-org')
  async switchOrg(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(switchOrgSchema)) body: { orgId: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { org, membership } = await this.users.switchOrg(user.sub, body.orgId);
    const state = await this.users.authState(user.sub);
    const jti = randomUUID();
    await this.users.setRefreshJti(user.sub, jti);
    const tokens = await this.auth.issueTokens(
      {
        sub: user.sub,
        accountId: user.accountId,
        orgId: org.id,
        role: membership.role,
        network: org.network ?? state?.network,
      },
      state?.tokenVersion ?? 0,
      jti,
    );
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...cookieOptions(),
      maxAge: 15 * 60 * 1000,
    });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...cookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return {
      org: { id: org.id, name: org.name, slug: org.slug },
      role: membership.role,
    };
  }

  @Public()
  @Get('me')
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const current = await this.auth.session(req.cookies?.[ACCESS_COOKIE]);
    if (current.user) return current;
    // Access cookie is gone (15m TTL) but the refresh cookie may still be valid.
    try {
      const tokens = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
      res.cookie(ACCESS_COOKIE, tokens.accessToken, {
        ...cookieOptions(),
        maxAge: 15 * 60 * 1000,
      });
      res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
        ...cookieOptions(),
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      return this.auth.session(tokens.accessToken);
    } catch {
      return current;
    }
  }
}
