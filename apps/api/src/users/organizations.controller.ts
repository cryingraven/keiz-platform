import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  OrgCollectionInput,
  UpdateOrganizationProfileInput,
  orgCollectionSchema,
  updateOrganizationProfileSchema,
} from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { OrgCollectionService } from './org-collection.service';
import { UsersService } from './users.service';

@Controller('orgs')
export class OrganizationsController {
  constructor(
    private readonly collection: OrgCollectionService,
    private readonly users: UsersService,
  ) {}

  @Get('current')
  profile(@CurrentUser() user: AuthUser) {
    return this.users.organizationProfile(user.orgId);
  }

  @Roles('ADMIN', 'OWNER')
  @Patch('current')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(updateOrganizationProfileSchema))
    body: UpdateOrganizationProfileInput,
  ) {
    return this.users.updateOrganizationProfile(user.orgId, body);
  }

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
