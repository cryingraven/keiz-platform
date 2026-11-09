import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvoicesModule } from '../invoices/invoices.module';
import { VendorsModule } from '../vendors/vendors.module';
import { PaymentEvent, PaymentEventSchema } from './payment-event.schema';
import { NearTxVerifier } from './near-tx-verifier';
import { PaymentProviderFactory } from './payment-provider.factory';
import { Payment, PaymentSchema } from './payment.schema';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    InvoicesModule,
    VendorsModule,
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: PaymentEvent.name, schema: PaymentEventSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentProviderFactory, NearTxVerifier],
  exports: [PaymentsService, PaymentProviderFactory],
})
export class PaymentsModule {}
