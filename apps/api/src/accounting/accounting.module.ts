import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from '../invoices/invoice.schema';
import { Receivable, ReceivableSchema } from '../receivables/receivable.schema';
import { Account, AccountSchema } from './account.schema';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { JournalEntry, JournalEntrySchema } from './journal-entry.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Account.name, schema: AccountSchema },
      { name: JournalEntry.name, schema: JournalEntrySchema },
      // Registered here so `rebuild` can scan the subledgers without importing
      // the feature modules (which would create a cycle).
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Receivable.name, schema: ReceivableSchema },
    ]),
  ],
  controllers: [AccountingController],
  providers: [AccountingService],
  exports: [AccountingService],
})
export class AccountingModule {}
