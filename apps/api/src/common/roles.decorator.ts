import { SetMetadata } from '@nestjs/common';
import type { Role } from '@keiz/shared';

export const ROLES_KEY = 'keiz:roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
