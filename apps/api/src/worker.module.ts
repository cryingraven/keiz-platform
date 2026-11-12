import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
import { CollectionsModule } from './collections/collections.module';
import { IndexerModule } from './indexer/indexer.module';
import { OutlayerModule } from './outlayer/outlayer.module';
import { PaymentsModule } from './payments/payments.module';
import { CollectionDeployProcessor } from './queues/processors/collection-deploy.processor';
import { IndexerSyncProcessor } from './queues/processors/indexer-sync.processor';
import { OutlayerPollProcessor } from './queues/processors/outlayer-poll.processor';
import { PaymentPollProcessor } from './queues/processors/payment-poll.processor';
import {
  COLLECTIONS_QUEUE,
  INDEXER_QUEUE,
  OUTLAYER_QUEUE,
  PAYMENTS_QUEUE,
} from './queues/queue.constants';
import { QueuesModule } from './queues/queues.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI') ?? 'mongodb://127.0.0.1:27017/keiz',
        autoIndex: config.get('NODE_ENV') !== 'production',
      }),
    }),
    QueuesModule,
    BullModule.registerQueue(
      { name: PAYMENTS_QUEUE },
      { name: OUTLAYER_QUEUE },
      { name: INDEXER_QUEUE },
      { name: COLLECTIONS_QUEUE },
    ),
    PaymentsModule,
    OutlayerModule,
    IndexerModule,
    AuthModule,
    AgentModule,
    CollectionsModule,
  ],
  providers: [
    PaymentPollProcessor,
    OutlayerPollProcessor,
    IndexerSyncProcessor,
    CollectionDeployProcessor,
  ],
})
export class WorkerModule {}
