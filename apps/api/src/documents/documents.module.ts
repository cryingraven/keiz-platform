import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from '../invoices/invoice.schema';
import { Customer, CustomerSchema } from '../receivables/customer.schema';
import { Receivable, ReceivableSchema } from '../receivables/receivable.schema';
import { Organization, OrganizationSchema } from '../users/organization.schema';
import { Vendor, VendorSchema } from '../vendors/vendor.schema';
import { DocumentShare, DocumentShareSchema } from './document-share.schema';
import { DocumentPdfService } from './document-pdf.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PublicDocumentsController } from './public-documents.controller';

@Module({
  imports: [
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
  providers: [DocumentsService, DocumentPdfService],
})
export class DocumentsModule {}
