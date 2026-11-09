import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  loginVerifySchema,
  passkeyCredentialOptionsSchema,
  passkeyCredentialVerifySchema,
  passkeyLoginVerifySchema,
  passkeySignupOptionsSchema,
  passkeySignupVerifySchema,
  passkeyUnlockSchema,
} from '@keiz/shared';
import { AuthUser, CurrentUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { ZodBody } from '../../common/zod-body';
import { setSessionCookies } from '../auth-cookie';
import { PasskeyService } from './passkey.service';

@Controller('auth/passkey')
export class PasskeyController {
  constructor(private readonly passkeys: PasskeyService) {}

  /** Enrolling or removing a credential is a step-up action. */
  private assertFreshAuth(user: AuthUser): void {
    const now = Math.floor(Date.now() / 1000);
    if (!user.authTime || now - user.authTime > 10 * 60) {
      throw new ForbiddenException(
        'Re-authenticate with your wallet or passkey before changing passkeys.',
      );
    }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signup/options')
  signupOptions(
    @Body(new ZodBody(passkeySignupOptionsSchema))
    body: { accountId: string; nearPublicKey: string },
  ) {
    return this.passkeys.signupOptions(body.accountId, body.nearPublicKey);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signup/verify')
  async signupVerify(
    @Body(new ZodBody(passkeySignupVerifySchema))
    body: Parameters<PasskeyService['signupVerify']>[0],
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.passkeys.signupVerify(body);
    setSessionCookies(res, result);
    const { accessToken, refreshToken, ...session } = result;
    void accessToken;
    void refreshToken;
    return session;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('recovery/verify')
  async recoveryVerify(
    @Body(new ZodBody(loginVerifySchema))
    body: { accountId: string; publicKey: string; signature: string; nonce: string; recipient: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.passkeys.recoveryVerify(body);
    setSessionCookies(res, result);
    const { accessToken, refreshToken, ...session } = result;
    void accessToken;
    void refreshToken;
    return session;
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('login/options')
  loginOptions() {
    return this.passkeys.loginOptions();
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('login/verify')
  async loginVerify(
    @Body(new ZodBody(passkeyLoginVerifySchema))
    body: { credential: Parameters<PasskeyService['loginVerify']>[0]; accountId?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.passkeys.loginVerify(body.credential, body.accountId);
    setSessionCookies(res, result);
    const { accessToken, refreshToken, ...session } = result;
    void accessToken;
    void refreshToken;
    return session;
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('credentials/options')
  credentialOptions(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(passkeyCredentialOptionsSchema)) body: { nearPublicKey: string },
  ) {
    this.assertFreshAuth(user);
    return this.passkeys.credentialOptions(user.sub, user.accountId, body.nearPublicKey);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('credentials')
  addCredential(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(passkeyCredentialVerifySchema))
    body: Parameters<PasskeyService['addCredential']>[1],
  ) {
    this.assertFreshAuth(user);
    return this.passkeys.addCredential(user.sub, body);
  }

  @Get('credentials')
  listCredentials(@CurrentUser() user: AuthUser) {
    return this.passkeys.listCredentials(user.sub);
  }

  @Delete('credentials/:id')
  removeCredential(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('confirmRecovery') confirmRecovery?: string,
  ) {
    this.assertFreshAuth(user);
    return this.passkeys.removeCredential(user.sub, id, confirmRecovery === 'true');
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('unlock')
  unlock(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(passkeyUnlockSchema)) body: { credentialId: string },
  ) {
    return this.passkeys.unlock(user.sub, body.credentialId);
  }
}
