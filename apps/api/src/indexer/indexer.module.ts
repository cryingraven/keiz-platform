import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from '../payments/payment.schema';
import { ChainEvent, ChainEventSchema } from './chain-event.schema';
import { IndexerController } from './indexer.controller';
import { IndexerService } from './indexer.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChainEvent.name, schema: ChainEventSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
  ],
  controllers: [IndexerController],
  providers: [IndexerService],
})
export class IndexerModule {}
