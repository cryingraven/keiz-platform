import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Roles('ADMIN', 'OWNER')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.audit.list(user.orgId);
  }
}
