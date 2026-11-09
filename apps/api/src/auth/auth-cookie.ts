import type { Response } from 'express';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../common/jwt-auth.guard';
import type { SessionTokens } from './auth.service';

export function cookieOptions() {
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

export function setSessionCookies(res: Response, tokens: SessionTokens): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...cookieOptions(),
    maxAge: 15 * 60 * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...cookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
