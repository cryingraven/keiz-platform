import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
import { IndexerModule } from './indexer/indexer.module';
import { OutlayerModule } from './outlayer/outlayer.module';
import { PaymentsModule } from './payments/payments.module';
import { IndexerSyncProcessor } from './queues/processors/indexer-sync.processor';
import { NearAuthRelayProcessor } from './queues/processors/near-auth-relay.processor';
import { OutlayerPollProcessor } from './queues/processors/outlayer-poll.processor';
import { PaymentPollProcessor } from './queues/processors/payment-poll.processor';
import {
  INDEXER_QUEUE,
  NEAR_AUTH_QUEUE,
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
      { name: NEAR_AUTH_QUEUE },
    ),
    PaymentsModule,
    OutlayerModule,
    IndexerModule,
    AuthModule,
    AgentModule,
  ],
  providers: [
    PaymentPollProcessor,
    OutlayerPollProcessor,
    IndexerSyncProcessor,
    NearAuthRelayProcessor,
  ],
})
export class WorkerModule {}
