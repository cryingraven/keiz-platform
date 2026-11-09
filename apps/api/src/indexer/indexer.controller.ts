import { Controller, Get, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { IndexerService } from './indexer.service';

@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexer: IndexerService) {}

  @Get('events')
  events(@CurrentUser() user: AuthUser) {
    return this.indexer.list(user.orgId);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('backfill/:paymentId')
  backfill(@CurrentUser() user: AuthUser, @Param('paymentId') paymentId: string) {
    return this.indexer.backfill(user.orgId, paymentId);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('collect')
  collect() {
    return this.indexer.syncCollectReceipts(100);
  }
}
