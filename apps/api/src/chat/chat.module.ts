import { Module, OnModuleDestroy, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountingService } from '../accounting/accounting.service';
import { AgentModule } from '../agent/agent.module';
import { AgentJobsService } from '../agent/agent-jobs.service';
import { AgentService } from '../agent/agent.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { ReceivablesModule } from '../receivables/receivables.module';
import { ReceivablesService } from '../receivables/receivables.service';
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
  imports: [
    AccountingModule,
    AgentModule,
    InvoicesModule,
    VendorsModule,
    PaymentsModule,
    ReceivablesModule,
  ],
  controllers: [ChatController],
  providers: [
    {
      provide: MASTRA,
      inject: [
        ConfigService,
        InvoicesService,
        VendorsService,
        PaymentsService,
        AgentService,
        AgentJobsService,
        AccountingService,
        ReceivablesService,
      ],
      useFactory: (
        config: ConfigService,
        invoices: InvoicesService,
        vendors: VendorsService,
        payments: PaymentsService,
        agent: AgentService,
        jobs: AgentJobsService,
        accounting: AccountingService,
        receivables: ReceivablesService,
      ) =>
        createKeizMastra({
          config,
          invoices,
          vendors,
          payments,
          agent,
          jobs,
          accounting,
          receivables,
        }),
    },
    MastraLifecycle,
    ChatService,
  ],
  exports: [ChatService],
})
export class ChatModule {}
