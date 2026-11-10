import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AccountingQuery,
  AgingQuery,
  JournalExportQuery,
  JournalQuery,
  ManualJournalInput,
  TrialBalanceQuery,
  accountingQuerySchema,
  agingQuerySchema,
  journalExportQuerySchema,
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

  @Get('journal-entries/export')
  async exportJournal(
    @CurrentUser() user: AuthUser,
    @Query(new ZodBody(journalExportQuerySchema)) query: JournalExportQuery,
    @Res() res: Response,
  ) {
    const csv = await this.accounting.journalCsv(user.orgId, query);
    const from = query.from ? query.from.slice(0, 10) : 'all';
    const to = query.to ? query.to.slice(0, 10) : 'all';
    const filename = `keiz-journal-${query.currency ?? 'all'}-${from}-to-${to}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
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
