import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CollectionQuoteInput,
  CreateReceivableInput,
  ReceivableListQuery,
  RecordReceiptInput,
  collectionQuoteSchema,
  createReceivableSchema,
  receivableListQuerySchema,
  recordReceiptSchema,
} from '@keiz/shared';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { ArCollectionService } from './ar-collection.service';
import { ReceivablesService } from './receivables.service';

@Controller('receivables')
export class ReceivablesController {
  constructor(
    private readonly receivables: ReceivablesService,
    private readonly collection: ArCollectionService,
  ) {}

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

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/collection-quote')
  collectionQuote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodBody(collectionQuoteSchema)) body: CollectionQuoteInput,
  ) {
    return this.collection.quote(user.orgId, id, body);
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
