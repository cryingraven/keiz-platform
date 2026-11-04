import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  AccountingQuery,
  AgingQuery,
  JournalQuery,
  ManualJournalInput,
  TrialBalanceQuery,
  accountingQuerySchema,
  agingQuerySchema,
  journalQuerySchema,
  manualJournalSchema,
  trialBalanceQuerySchema,
} from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { ZodBody } from '../common/zod-body';
import { AccountingService } from './accounting.service';

@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('accounts')
  accounts(@CurrentUser() user: AuthUser) {
    return this.accounting.listAccounts(user.orgId);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(accountingQuerySchema)) query: AccountingQuery,
  ) {
    return this.accounting.summary(user.orgId, query);
  }

  @Get('trial-balance')
  trialBalance(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(trialBalanceQuerySchema)) query: TrialBalanceQuery,
  ) {
    return this.accounting.trialBalance(user.orgId, query);
  }

  @Get('journal-entries')
  journal(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(journalQuerySchema)) query: JournalQuery,
  ) {
    return this.accounting.journal(user.orgId, query);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('journal-entries')
  postManual(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(manualJournalSchema)) body: ManualJournalInput,
  ) {
    return this.accounting.postManual(user.orgId, user.sub, body);
  }

  @Get('aging')
  aging(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(agingQuerySchema)) query: AgingQuery,
  ) {
    return this.accounting.aging(user.orgId, query.side, query.currency);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('rebuild')
  rebuild(@CurrentUser() user: AuthUser) {
    return this.accounting.rebuild(user.orgId);
  }
}
