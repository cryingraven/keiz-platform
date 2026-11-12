import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CollectionDeployInput, collectionDeploySchema } from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { CollectionDeployService } from './collect-deploy.service';

@Controller('orgs/current/collection')
export class CollectionsController {
  constructor(private readonly deploy: CollectionDeployService) {}

  @Get('deploy')
  capabilities(@CurrentUser() user: AuthUser) {
    return this.deploy.capabilities(user.orgId);
  }

  @Get('deploy/:id')
  deployment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deploy.get(user.orgId, id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('deploy')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(collectionDeploySchema)) body: CollectionDeployInput,
  ) {
    return this.deploy.request(user.orgId, user.sub, user.accountId, body);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('deploy/:id/retry')
  retry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deploy.retry(user.orgId, id);
  }
}
