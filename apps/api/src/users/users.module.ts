import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MembersController } from './members.controller';
import { Organization, OrganizationSchema } from './organization.schema';
import { Membership, MembershipSchema } from './membership.schema';
import { User, UserSchema } from './user.schema';
import { UsersService } from './users.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Membership.name, schema: MembershipSchema },
    ]),
  ],
  controllers: [MembersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
