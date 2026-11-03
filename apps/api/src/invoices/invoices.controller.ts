import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { createInvoiceSchema, CreateInvoiceInput, invoiceDecisionSchema } from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { invoiceListQuerySchema } from '@keiz/shared';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(invoiceListQuerySchema)) query: { status?: string },
  ) {
    return this.invoices.list(user.orgId, query.status);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.invoices.summary(user.orgId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoices.findOne(user.orgId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(createInvoiceSchema)) body: CreateInvoiceInput,
  ) {
    return this.invoices.create(user.orgId, user.sub, body);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoices.submit(user.orgId, id);
  }

  @Roles('APPROVER', 'ADMIN', 'OWNER')
  @Post(':id/decision')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodBody(invoiceDecisionSchema))
    body: { decision: 'APPROVE' | 'REJECT'; comment?: string },
  ) {
    return this.invoices.decide(
      user.orgId,
      id,
      user.sub,
      user.accountId,
      body.decision,
      body.comment,
    );
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/void')
  void(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoices.void(user.orgId, id);
  }
}
