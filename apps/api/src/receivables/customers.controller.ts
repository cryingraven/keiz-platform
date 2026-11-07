import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  CreateCustomerInput,
  createCustomerSchema,
  updateCustomerSchema,
  UpdateCustomerInput,
} from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { ReceivablesService } from './receivables.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.receivables.listCustomers(user.orgId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(createCustomerSchema)) body: CreateCustomerInput,
  ) {
    return this.receivables.createCustomer(user.orgId, body);
  }

  @Roles('ADMIN', 'OWNER')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodBody(updateCustomerSchema)) body: UpdateCustomerInput,
  ) {
    return this.receivables.updateCustomer(user.orgId, id, body);
  }

  @Roles('ADMIN', 'OWNER')
  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.receivables.archiveCustomer(user.orgId, id);
  }
}
