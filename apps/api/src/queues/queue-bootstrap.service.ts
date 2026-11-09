import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { QueueProducer } from './queue-producer.service';

@Injectable()
export class QueueBootstrapService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueBootstrapService.name);

  constructor(private readonly producer: QueueProducer) {}

  async onModuleInit() {
    if (!this.producer.enabled) {
      this.logger.log('Queues are disabled (QUEUES_ENABLED=false)');
      return;
    }
    await this.producer.ensureSchedules();
    this.logger.log('Queue schedulers installed');
  }

  async onModuleDestroy() {
    await this.producer.close();
  }
}
