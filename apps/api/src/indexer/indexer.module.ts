import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from '../payments/payment.schema';
import { ReceivablesModule } from '../receivables/receivables.module';
import { Organization, OrganizationSchema } from '../users/organization.schema';
import { ChainEvent, ChainEventSchema } from './chain-event.schema';
import { IndexerCursor, IndexerCursorSchema } from './indexer-cursor.schema';
import { IndexerController } from './indexer.controller';
import { IndexerService } from './indexer.service';

@Module({
  imports: [
    ReceivablesModule,
    MongooseModule.forFeature([
      { name: ChainEvent.name, schema: ChainEventSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: IndexerCursor.name, schema: IndexerCursorSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [IndexerController],
  providers: [IndexerService],
  exports: [IndexerService],
})
export class IndexerModule {}
