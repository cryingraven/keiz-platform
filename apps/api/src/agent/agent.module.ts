import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvoicesModule } from '../invoices/invoices.module';
import { OutlayerModule } from '../outlayer/outlayer.module';
import { VendorsModule } from '../vendors/vendors.module';
import { PaymentsModule } from '../payments/payments.module';
import { Payment, PaymentSchema } from '../payments/payment.schema';
import { AgentAction, AgentActionSchema } from './agent-action.schema';
import { AgentDailySpend, AgentDailySpendSchema } from './agent-daily-spend.schema';
import { AgentWallet, AgentWalletSchema } from './agent-wallet.schema';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [
    InvoicesModule,
    VendorsModule,
    PaymentsModule,
    OutlayerModule,
    MongooseModule.forFeature([
      { name: AgentWallet.name, schema: AgentWalletSchema },
      { name: AgentAction.name, schema: AgentActionSchema },
      { name: AgentDailySpend.name, schema: AgentDailySpendSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
  ],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
