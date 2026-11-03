import { Module, OnModuleDestroy, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentModule } from '../agent/agent.module';
import { AgentService } from '../agent/agent.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { VendorsModule } from '../vendors/vendors.module';
import { VendorsService } from '../vendors/vendors.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { createKeizMastra, KeizMastra, MASTRA } from './mastra.provider';

@Injectable()
export class MastraLifecycle implements OnModuleDestroy {
  constructor(@Inject(MASTRA) private readonly keiz: KeizMastra) {}

  async onModuleDestroy() {
    await this.keiz.storage.close();
  }
}

@Module({
  imports: [AgentModule, InvoicesModule, VendorsModule, PaymentsModule],
  controllers: [ChatController],
  providers: [
    {
      provide: MASTRA,
      inject: [ConfigService, InvoicesService, VendorsService, PaymentsService, AgentService],
      useFactory: (
        config: ConfigService,
        invoices: InvoicesService,
        vendors: VendorsService,
        payments: PaymentsService,
        agent: AgentService,
      ) => createKeizMastra({ config, invoices, vendors, payments, agent }),
    },
    MastraLifecycle,
    ChatService,
  ],
  exports: [ChatService],
})
export class ChatModule {}
