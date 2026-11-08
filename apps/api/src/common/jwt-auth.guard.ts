import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from './public.decorator';
import { UsersService } from '../users/users.service';

export const ACCESS_COOKIE = 'keiz_access';
export const REFRESH_COOKIE = 'keiz_refresh';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const token = req.cookies?.[ACCESS_COOKIE] || bearer;
    if (!token) throw new UnauthorizedException('Sign in with your NEAR wallet');

    let payload: {
      sub?: string;
      orgId?: string;
      type?: string;
      ver?: number;
      network?: string;
      [key: string]: unknown;
    };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      if (payload.type !== 'access') throw new Error('wrong token type');
      if (!payload.sub || !payload.orgId) throw new Error('incomplete token');
    } catch {
      throw new UnauthorizedException('Session expired');
    }

    // Load the membership fresh: a stale JWT must not keep a removed user or
    // an old role alive for the lifetime of the token. Database failures are
    // NOT auth failures: let them surface as 5xx instead of logging everyone out.
    const { user, membership } = await this.users.sessionContext(payload.sub, payload.orgId);
    if (!user || !membership) throw new UnauthorizedException('Session expired');
    if ((payload.ver ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new UnauthorizedException('Session expired');
    }
    if (user.network && payload.network && payload.network !== user.network) {
      throw new UnauthorizedException('Session network mismatch');
    }

    req.user = {
      sub: user.id,
      accountId: user.accountId,
      orgId: membership.orgId,
      role: membership.role,
    };
    return true;
  }
}
