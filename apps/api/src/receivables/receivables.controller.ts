import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CreateReceivableInput,
  ReceivableListQuery,
  RecordReceiptInput,
  createReceivableSchema,
  receivableListQuerySchema,
  recordReceiptSchema,
} from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { ReceivablesService } from './receivables.service';

@Controller('receivables')
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(receivableListQuerySchema)) query: ReceivableListQuery,
  ) {
    return this.receivables.list(user.orgId, query);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(receivableListQuerySchema)) query: ReceivableListQuery,
  ) {
    return this.receivables.summary(user.orgId, query.currency ?? 'USD');
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.receivables.findOne(user.orgId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(createReceivableSchema)) body: CreateReceivableInput,
  ) {
    return this.receivables.create(user.orgId, user.sub, body);
  }

  @Post(':id/issue')
  issue(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.receivables.issue(user.orgId, id);
  }

  @Roles('APPROVER', 'ADMIN', 'OWNER')
  @Post(':id/receipts')
  receipt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodBody(recordReceiptSchema)) body: RecordReceiptInput,
  ) {
    return this.receivables.recordReceipt(user.orgId, user.sub, id, body);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/void')
  void(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.receivables.void(user.orgId, id);
  }
}
