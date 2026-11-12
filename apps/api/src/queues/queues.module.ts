import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueBootstrapService } from './queue-bootstrap.service';
import { QueueProducer } from './queue-producer.service';
import { INDEXER_QUEUE, COLLECTIONS_QUEUE, OUTLAYER_QUEUE, PAYMENTS_QUEUE } from './queue.constants';

if (!process.env.QUEUES_ENABLED) {
  try {
    // ConfigModule loads env later; queue registration is decided at import time.
    process.loadEnvFile?.('../../.env');
  } catch {
    // Missing .env is fine; default to enabled.
  }
}

const queuesEnabled = process.env.QUEUES_ENABLED !== 'false';

const bullImports = queuesEnabled
  ? [
      BullModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          connection: {
            url: config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379',
          },
          prefix: config.get<string>('QUEUE_PREFIX') || 'keiz',
        }),
      }),
      BullModule.registerQueue(
        { name: PAYMENTS_QUEUE },
        { name: OUTLAYER_QUEUE },
        { name: INDEXER_QUEUE },
        { name: COLLECTIONS_QUEUE },
      ),
    ]
  : [];

@Global()
@Module({
  imports: bullImports,
  providers: [QueueProducer, QueueBootstrapService],
  exports: [QueueProducer, QueueBootstrapService],
})
export class QueuesModule {}
