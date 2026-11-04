import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateCustomerInput, createCustomerSchema } from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
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
}
