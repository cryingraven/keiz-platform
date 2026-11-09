import { Body, Controller, Get, Patch } from '@nestjs/common';
import { OrgCollectionInput, orgCollectionSchema } from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { OrgCollectionService } from './org-collection.service';

@Controller('orgs')
export class OrganizationsController {
  constructor(private readonly collection: OrgCollectionService) {}

  @Get('current/collection')
  get(@CurrentUser() user: AuthUser) {
    return this.collection.get(user.orgId);
  }

  @Roles('ADMIN', 'OWNER')
  @Patch('current/collection')
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(orgCollectionSchema)) body: OrgCollectionInput,
  ) {
    return this.collection.update(user.orgId, body);
  }
}
