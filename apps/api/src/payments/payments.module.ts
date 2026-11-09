import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvoicesModule } from '../invoices/invoices.module';
import { VendorsModule } from '../vendors/vendors.module';
import { PaymentEvent, PaymentEventSchema } from './payment-event.schema';
import { PaymentAttempt, PaymentAttemptSchema, PaymentIntent, PaymentIntentSchema } from './payment-intent.schema';
import { PaymentIntentsService } from './payment-intents.service';
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
      { name: PaymentIntent.name, schema: PaymentIntentSchema },
      { name: PaymentAttempt.name, schema: PaymentAttemptSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentProviderFactory, NearTxVerifier, PaymentIntentsService],
  exports: [PaymentsService, PaymentProviderFactory, PaymentIntentsService],
})
export class PaymentsModule {}
