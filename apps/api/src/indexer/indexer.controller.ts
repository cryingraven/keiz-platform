import { Controller, Get, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { IndexerService } from './indexer.service';

@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexer: IndexerService) {}

  @Get('events')
  events(@CurrentUser() user: AuthUser) {
    return this.indexer.list(user.orgId);
  }

  @Post('backfill/:paymentId')
  backfill(@CurrentUser() user: AuthUser, @Param('paymentId') paymentId: string) {
    return this.indexer.backfill(user.orgId, paymentId);
  }
}
