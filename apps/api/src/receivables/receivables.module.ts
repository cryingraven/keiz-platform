import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountingModule } from '../accounting/accounting.module';
import { Customer, CustomerSchema } from './customer.schema';
import { CustomersController } from './customers.controller';
import { Receivable, ReceivableSchema } from './receivable.schema';
import { ReceivablesController } from './receivables.controller';
import { ReceivablesService } from './receivables.service';

@Module({
  imports: [
    AccountingModule,
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Receivable.name, schema: ReceivableSchema },
    ]),
  ],
  controllers: [CustomersController, ReceivablesController],
  providers: [ReceivablesService],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
