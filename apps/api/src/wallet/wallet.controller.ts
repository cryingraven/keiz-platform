import { Controller, Get, Param, Query } from '@nestjs/common';
import { walletRecipientQuerySchema, type WalletRecipientQuery } from '@keiz/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodBody } from '../common/zod-body';
import { WalletService } from './wallet.service';

@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /**
   * The signed-in user's own wallet. The account id is always taken from the
   * JWT; it is never accepted from the query string.
   */
  @Get()
  overview(@CurrentUser() user: AuthUser, @Query('refresh') refresh?: string) {
    return this.wallet.overview(user.accountId, refresh === '1' || refresh === 'true');
  }

  /** Public on-chain data used to warn before a transfer is signed. */
  @Get('recipient/:accountId')
  recipient(
    @Param('accountId') accountId: string,
    @Query(new ZodBody(walletRecipientQuerySchema)) query: WalletRecipientQuery,
  ) {
    return this.wallet.recipient(accountId, query.contractId);
  }
}
