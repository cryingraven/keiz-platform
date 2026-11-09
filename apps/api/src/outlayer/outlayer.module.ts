import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentAction, AgentActionSchema } from '../agent/agent-action.schema';
import { AgentWallet, AgentWalletSchema } from '../agent/agent-wallet.schema';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentEvent, PaymentEventSchema } from '../payments/payment-event.schema';
import { Payment, PaymentSchema } from '../payments/payment.schema';
import { OutlayerPoller } from './outlayer.poller';
import { OutlayerService } from './outlayer.service';

@Module({
  imports: [
    InvoicesModule,
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: PaymentEvent.name, schema: PaymentEventSchema },
      { name: AgentWallet.name, schema: AgentWalletSchema },
      { name: AgentAction.name, schema: AgentActionSchema },
    ]),
  ],
  providers: [OutlayerService, OutlayerPoller],
  exports: [OutlayerService, OutlayerPoller],
})
export class OutlayerModule {}
