import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from '../invoices/invoice.schema';
import { PaymentsModule } from '../payments/payments.module';
import { Customer, CustomerSchema } from '../receivables/customer.schema';
import { Receivable, ReceivableSchema } from '../receivables/receivable.schema';
import { ReceivablesModule } from '../receivables/receivables.module';
import { Organization, OrganizationSchema } from '../users/organization.schema';
import { UsersModule } from '../users/users.module';
import { Vendor, VendorSchema } from '../vendors/vendor.schema';
import { DocumentShare, DocumentShareSchema } from './document-share.schema';
import { DocumentPdfService } from './document-pdf.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PublicDocumentsController } from './public-documents.controller';
import { PublicPaymentsService } from './public-payments.service';

@Module({
  imports: [
    ReceivablesModule,
    PaymentsModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: DocumentShare.name, schema: DocumentShareSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Receivable.name, schema: ReceivableSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [DocumentsController, PublicDocumentsController],
  providers: [DocumentsService, DocumentPdfService, PublicPaymentsService],
})
export class DocumentsModule {}
