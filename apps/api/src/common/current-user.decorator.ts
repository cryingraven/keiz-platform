import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AuthMethod = 'wallet' | 'passkey' | 'recovery';

export interface AuthUser {
  sub: string;
  accountId: string;
  orgId: string;
  role: string;
  amr?: AuthMethod;
  authTime?: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);
