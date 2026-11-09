import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  confirmDepositSchema,
  createPaymentSchema,
  CreatePaymentInput,
  PaymentListQuery,
  paymentListQuerySchema,
  simulateQuerySchema,
} from '@keiz/shared';
import { Roles } from '../common/roles.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodBody } from '../common/zod-body';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(paymentListQuerySchema)) query: PaymentListQuery,
  ) {
    return this.payments.list(user.orgId, query);
  }

  @Get('open')
  open(@CurrentUser() user: AuthUser) {
    return this.payments.listOpen(user.orgId);
  }

  @Get('tokens')
  tokens() {
    return this.payments.tokens();
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.findOne(user.orgId, id);
  }

  @Get(':id/events')
  events(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.eventsFor(user.orgId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(createPaymentSchema)) body: CreatePaymentInput,
  ) {
    return this.payments.create(user.orgId, user.sub, user.accountId, body);
  }

  @Post(':id/deposit')
  deposit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodBody(confirmDepositSchema)) body: { txHash: string },
  ) {
    return this.payments.confirmDeposit(user.orgId, id, user.accountId, body.txHash);
  }

  @Post(':id/refresh')
  refresh(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.refresh(user.orgId, id);
  }

  /** Mock mode only - lets a demo reach a terminal state without waiting. */
  @Roles('ADMIN', 'OWNER')
  @Post(':id/simulate')
  simulate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodBody(simulateQuerySchema)) query: { status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED' },
  ) {
    return this.payments.simulate(user.orgId, id, query.status);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.cancel(user.orgId, id);
  }
}
