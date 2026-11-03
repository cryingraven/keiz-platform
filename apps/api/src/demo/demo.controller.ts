import { Controller, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { DemoService } from './demo.service';

@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Roles('OWNER')
  @Post('seed')
  seed(@CurrentUser() user: AuthUser) {
    return this.demo.seed(user.orgId, user.sub, user.accountId);
  }
}
