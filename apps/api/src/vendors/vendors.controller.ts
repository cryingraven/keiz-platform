import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { createVendorSchema, CreateVendorInput } from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { VendorsService } from './vendors.service';

@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.vendors.list(user.orgId);
  }

  @Roles('ADMIN', 'OWNER')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(createVendorSchema)) body: CreateVendorInput,
  ) {
    return this.vendors.create(user.orgId, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vendors.findOne(user.orgId, id);
  }
}
