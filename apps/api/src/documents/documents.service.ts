import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import type { DocumentType } from '@keiz/shared';
import { Invoice, InvoiceDocument } from '../invoices/invoice.schema';
import { Customer, CustomerDocument } from '../receivables/customer.schema';
import { Receivable, ReceivableDocument } from '../receivables/receivable.schema';
import { Organization, OrganizationDocument } from '../users/organization.schema';
import { Vendor, VendorDocument } from '../vendors/vendor.schema';
import { DocumentShare, DocumentShareDocument } from './document-share.schema';
import { DocumentPdfService } from './document-pdf.service';
import type {
  CreatedDocumentShare,
  DocumentShareMeta,
  LoadedDocument,
  PublicDocument,
} from './documents.types';

const DAY = 86_400_000;
const BILL_SHAREABLE = ['SUBMITTED', 'APPROVED', 'PAYMENT_PENDING', 'PAID'];
const INVOICE_SHAREABLE = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'document';
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(DocumentShare.name)
    private readonly shares: Model<DocumentShareDocument>,
    @InjectModel(Invoice.name)
    private readonly invoices: Model<InvoiceDocument>,
    @InjectModel(Receivable.name)
    private readonly receivables: Model<ReceivableDocument>,
    @InjectModel(Vendor.name)
    private readonly vendors: Model<VendorDocument>,
    @InjectModel(Customer.name)
    private readonly customers: Model<CustomerDocument>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<OrganizationDocument>,
    private readonly pdf: DocumentPdfService,
  ) {}

  private normalizeType(type: string): DocumentType {
    if (type !== 'bill' && type !== 'invoice') {
      throw new BadRequestException('Document type must be bill or invoice');
    }
    return type;
  }

  private async resolveDocument(
    orgId: string,
    type: DocumentType,
    id: string,
  ): Promise<LoadedDocument> {
    const org = await this.organizations.findById(orgId).lean();
    if (!org) throw new NotFoundException('Workspace not found');

    if (type === 'bill') {
      const invoice = await this.invoices.findOne({ _id: id, orgId }).lean();
      if (!invoice) throw new NotFoundException('Bill not found');
      const vendor = await this.vendors.findOne({ _id: invoice.vendorId, orgId }).lean();
      return {
        kind: 'bill',
        number: invoice.number,
        status: invoice.status,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        decimals: invoice.decimals,
        lineItems: invoice.lineItems,
        subtotal: invoice.subtotal,
        taxBps: invoice.taxBps,
        taxAmount: invoice.taxAmount,
        total: invoice.total,
        notes: invoice.notes,
        organizationName: org.name,
        counterparty: {
          name: vendor?.name ?? 'Vendor',
          email: vendor?.email ?? '',
        },
      };
    }

    const receivable = await this.receivables.findOne({ _id: id, orgId }).lean();
    if (!receivable) throw new NotFoundException('Invoice not found');
    const customer = await this.customers
      .findOne({ _id: receivable.customerId, orgId })
      .lean();
    return {
      kind: 'invoice',
      number: receivable.number,
      status: receivable.status,
      issueDate: receivable.issueDate,
      dueDate: receivable.dueDate,
      currency: receivable.currency,
      decimals: receivable.decimals,
      lineItems: receivable.lineItems,
      subtotal: receivable.subtotal,
      taxBps: receivable.taxBps,
      taxAmount: receivable.taxAmount,
      total: receivable.total,
      paidAmount: receivable.paidAmount,
      notes: receivable.notes,
      organizationName: org.name,
      counterparty: {
        name: customer?.name ?? 'Customer',
        email: customer?.email ?? '',
        taxId: customer?.taxId,
        billingAddress: customer?.billingAddress,
      },
    };
  }

  private isShareable(document: LoadedDocument): boolean {
    const allowed =
      document.kind === 'bill' ? BILL_SHAREABLE : INVOICE_SHAREABLE;
    return allowed.includes(document.status);
  }

  private assertShareable(document: LoadedDocument): void {
    if (!this.isShareable(document)) {
      throw new BadRequestException(
        document.kind === 'bill'
          ? 'Only submitted, approved or paid bills can be shared'
          : 'Only issued, partially paid or paid invoices can be shared',
      );
    }
  }

  private publicStatus(document: LoadedDocument): string {
    if (document.kind === 'bill') {
      return document.status === 'PAID' ? 'Paid' : 'Open';
    }
    if (document.status === 'PAID') return 'Paid';
    if (
      ['ISSUED', 'PARTIALLY_PAID'].includes(document.status) &&
      new Date(document.dueDate).getTime() < Date.now()
    ) {
      return 'Overdue';
    }
    if (document.status === 'PARTIALLY_PAID') return 'Partially paid';
    return 'Issued';
  }

  private toPublic(
    document: LoadedDocument,
    expiresAt?: Date,
  ): PublicDocument {
    const amountDue =
      document.kind === 'invoice'
        ? (BigInt(document.total) - BigInt(document.paidAmount ?? '0')).toString()
        : undefined;
    return {
      ...document,
      title: document.kind === 'bill' ? 'Bill' : 'Invoice',
      status: this.publicStatus(document),
      issueDate: document.issueDate.toISOString(),
      dueDate: document.dueDate.toISOString(),
      amountDue,
      expiresAt: expiresAt?.toISOString(),
    };
  }

  async createShare(
    orgId: string,
    userId: string,
    type: string,
    id: string,
    expiresInDays: number,
  ): Promise<CreatedDocumentShare> {
    const documentType = this.normalizeType(type);
    const document = await this.resolveDocument(orgId, documentType, id);
    this.assertShareable(document);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + expiresInDays * DAY);
    const tokenHash = hashToken(token);
    const existing = await this.shares.findOne({
      orgId,
      documentType,
      documentId: id,
    });

    if (existing) {
      existing.tokenHash = tokenHash;
      existing.expiresAt = expiresAt;
      existing.revokedAt = null;
      existing.createdByUserId = userId;
      existing.viewCount = 0;
      existing.lastViewedAt = null;
      await existing.save();
    } else {
      await this.shares.create({
        orgId,
        documentType,
        documentId: id,
        tokenHash,
        expiresAt,
        createdByUserId: userId,
        viewCount: 0,
      });
    }

    return {
      token,
      path: `/share/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getShareMeta(
    orgId: string,
    type: string,
    id: string,
  ): Promise<DocumentShareMeta> {
    const documentType = this.normalizeType(type);
    const share = await this.shares
      .findOne({ orgId, documentType, documentId: id })
      .lean();
    if (!share) {
      return {
        active: false,
        expiresAt: null,
        revokedAt: null,
        createdAt: null,
        lastViewedAt: null,
        viewCount: 0,
      };
    }
    return {
      active:
        !share.revokedAt && new Date(share.expiresAt).getTime() > Date.now(),
      expiresAt: share.expiresAt.toISOString(),
      revokedAt: share.revokedAt ? share.revokedAt.toISOString() : null,
      createdAt: share.createdAt ? share.createdAt.toISOString() : null,
      lastViewedAt: share.lastViewedAt
        ? share.lastViewedAt.toISOString()
        : null,
      viewCount: share.viewCount ?? 0,
    };
  }

  async revokeShare(orgId: string, type: string, id: string) {
    const documentType = this.normalizeType(type);
    const share = await this.shares.findOneAndUpdate(
      { orgId, documentType, documentId: id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!share) throw new NotFoundException('Active share link not found');
    return { revoked: true };
  }

  async shareContext(
    token: string,
    options: { requireActive?: boolean; requireShareable?: boolean } = {},
  ) {
    const share = await this.findShare(token, options);
    const document = await this.resolveDocument(
      share.orgId,
      share.documentType,
      share.documentId,
    );
    if (options.requireShareable !== false && !this.isShareable(document)) {
      throw new NotFoundException('This link is no longer available');
    }
    return { share, document };
  }

  private async findShare(token: string, options: { requireActive?: boolean } = {}) {
    if (!token || token.length < 20) {
      throw new NotFoundException('This link is no longer available');
    }
    const filter: Record<string, unknown> = {
      tokenHash: hashToken(token),
      revokedAt: null,
    };
    if (options.requireActive !== false) {
      filter.expiresAt = { $gt: new Date() };
    }
    const share = await this.shares.findOne(filter).lean();
    if (!share) throw new NotFoundException('This link is no longer available');
    return share;
  }

  async publicDocument(token: string): Promise<PublicDocument> {
    const share = await this.findShare(token);
    const document = await this.resolveDocument(
      share.orgId,
      share.documentType,
      share.documentId,
    );
    if (!this.isShareable(document)) {
      throw new NotFoundException('This link is no longer available');
    }
    await this.shares.updateOne(
      { _id: share._id },
      { $inc: { viewCount: 1 }, $set: { lastViewedAt: new Date() } },
    );
    return this.toPublic(document, share.expiresAt);
  }

  async publicPdf(token: string): Promise<{ document: PublicDocument; filename: string }> {
    const document = await this.publicDocument(token);
    return {
      document,
      filename: `keiz-${document.kind}-${safeFilenamePart(document.number)}.pdf`,
    };
  }

  async authenticatedPdf(
    orgId: string,
    type: string,
    id: string,
  ): Promise<{ document: PublicDocument; filename: string }> {
    const documentType = this.normalizeType(type);
    const document = await this.resolveDocument(orgId, documentType, id);
    return {
      document: this.toPublic(document),
      filename: `keiz-${document.kind}-${safeFilenamePart(document.number)}.pdf`,
    };
  }

  async renderPdf(document: PublicDocument): Promise<Buffer> {
    return this.pdf.render(document);
  }
}
