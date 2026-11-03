import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentModule } from '../agent/agent.module';
import { Invoice, InvoiceSchema } from '../invoices/invoice.schema';
import { InvoicesModule } from '../invoices/invoices.module';
import { Payment, PaymentSchema } from '../payments/payment.schema';
import { Vendor, VendorSchema } from '../vendors/vendor.schema';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({
  imports: [
    AgentModule,
    InvoicesModule,
    MongooseModule.forFeature([
      { name: Vendor.name, schema: VendorSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
  ],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
