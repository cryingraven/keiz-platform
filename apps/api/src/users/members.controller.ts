import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createMemberSchema,
  CreateMemberInput,
  updateMemberSchema,
  UpdateMemberInput,
} from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { UsersService } from './users.service';

@Controller('members')
export class MembersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.users.listMembers(user.orgId);
  }

  @Roles('ADMIN', 'OWNER')
  @Post()
  add(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(createMemberSchema)) body: CreateMemberInput,
  ) {
    return this.users
      .addMember(user.orgId, body.accountId, body.role)
      .then((member) => ({
        userId: member.id,
        accountId: member.accountId,
        role: body.role,
      }));
  }

  @Roles('ADMIN', 'OWNER')
  @Patch(':userId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body(new ZodBody(updateMemberSchema)) body: UpdateMemberInput,
  ) {
    return this.users.updateMemberRole(user.orgId, userId, body.role);
  }

  @Roles('ADMIN', 'OWNER')
  @Delete(':userId')
  remove(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.users.removeMember(user.orgId, userId);
  }
}
