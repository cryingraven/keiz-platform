import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountingModule } from '../accounting/accounting.module';
import { PaymentsModule } from '../payments/payments.module';
import { ArCollectionService } from './ar-collection.service';
import { Customer, CustomerSchema } from './customer.schema';
import { CustomersController } from './customers.controller';
import { Receivable, ReceivableSchema } from './receivable.schema';
import { ReceivablesController } from './receivables.controller';
import { ReceivablesService } from './receivables.service';

@Module({
  imports: [
    AccountingModule,
    PaymentsModule,
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Receivable.name, schema: ReceivableSchema },
    ]),
  ],
  controllers: [CustomersController, ReceivablesController],
  providers: [ReceivablesService, ArCollectionService],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
