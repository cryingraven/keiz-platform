import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CURRENCY_DECIMALS,
  CreateInvoiceInput,
  InvoiceListQuery,
  UpdateInvoiceInput,
  computeInvoiceTotals,
  formatUnits,
} from '@keiz/shared';
import { AccountingService } from '../accounting/accounting.service';
import { dateRange } from '../common/date-range';
import { NumberingService } from '../numbering/numbering.service';
import { UsersService } from '../users/users.service';
import { Invoice, InvoiceDocument } from './invoice.schema';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectModel(Invoice.name) private readonly invoices: Model<InvoiceDocument>,
    private readonly users: UsersService,
    private readonly accounting: AccountingService,
    private readonly numbering: NumberingService,
  ) {}

  async list(orgId: string, query: InvoiceListQuery) {
    const filter: Record<string, unknown> = { orgId };
    if (query.status) filter.status = query.status;
    if (query.vendorId) filter.vendorId = query.vendorId;
    const range = dateRange(query, query.dateField ?? 'issueDate');
    if (range) Object.assign(filter, range);
    return this.invoices.find(filter).sort({ createdAt: -1 }).lean();
  }

  async summary(orgId: string) {
    // Group by status AND currency, and keep money as a decimal string. Using
    // $toDouble here silently loses precision and mixes currencies together.
    const rows = await this.invoices
      .aggregate<{ _id: string; currency: string; count: number; total: string }>([
        { $match: { orgId } },
        {
          $group: {
            _id: { status: '$status', currency: '$currency' },
            count: { $sum: 1 },
            total: { $sum: { $toDecimal: '$total' } },
          },
        },
        {
          $project: {
            _id: '$_id.status',
            currency: '$_id.currency',
            count: 1,
            total: { $toString: '$total' },
          },
        },
        { $sort: { _id: 1, currency: 1 } },
      ])
      .exec();
    return rows;
  }

  async create(orgId: string, userId: string, input: CreateInvoiceInput) {
    const decimals = CURRENCY_DECIMALS[input.currency] ?? 2;
    let totals: ReturnType<typeof computeInvoiceTotals>;
    try {
      totals = computeInvoiceTotals(input.lineItems, decimals, input.taxBps);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    const number = input.number ?? (await this.numbering.next(orgId, 'BILL', issueDate));

    try {
      const invoice = await this.invoices.create({
        orgId,
        vendorId: input.vendorId,
        number,
        issueDate,
        dueDate: new Date(input.dueDate),
        currency: input.currency,
        decimals,
        lineItems: totals.lines,
        subtotal: totals.subtotal,
        taxBps: input.taxBps,
        taxAmount: totals.taxAmount,
        total: totals.total,
        status: 'DRAFT',
        notes: input.notes,
        createdByUserId: userId,
      });
      return invoice.toObject();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(`Bill ${number} already exists`);
      }
      throw error;
    }
  }

  /** Draft-only edit. Totals are always recomputed, never taken from the client. */
  async update(orgId: string, id: string, input: UpdateInvoiceInput) {
    const invoice = await this.invoices.findOne({ _id: id, orgId });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(`Only a DRAFT bill can be edited (currently ${invoice.status})`);
    }

    const decimals = CURRENCY_DECIMALS[input.currency] ?? 2;
    let totals: ReturnType<typeof computeInvoiceTotals>;
    try {
      totals = computeInvoiceTotals(input.lineItems, decimals, input.taxBps);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    invoice.vendorId = input.vendorId;
    invoice.issueDate = input.issueDate ? new Date(input.issueDate) : invoice.issueDate;
    invoice.dueDate = new Date(input.dueDate);
    invoice.currency = input.currency;
    invoice.decimals = decimals;
    invoice.lineItems = totals.lines as never;
    invoice.subtotal = totals.subtotal;
    invoice.taxBps = input.taxBps;
    invoice.taxAmount = totals.taxAmount;
    invoice.total = totals.total;
    invoice.notes = input.notes;
    await invoice.save();
    return invoice.toObject();
  }

  async findOne(orgId: string, id: string) {
    const invoice = await this.invoices.findOne({ _id: id, orgId }).lean();
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async submit(orgId: string, id: string) {
    return this.transition(orgId, id, ['DRAFT'], 'SUBMITTED');
  }

  async decide(
    orgId: string,
    id: string,
    userId: string,
    accountId: string,
    decision: 'APPROVE' | 'REJECT',
    comment?: string,
  ) {
    const invoice = await this.invoices.findOne({ _id: id, orgId });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'SUBMITTED') {
      throw new BadRequestException(`Cannot decide an invoice in status ${invoice.status}`);
    }
    // Segregation of duties: the creator cannot approve their own bill once the
    // workspace has another eligible approver. A solo workspace still works.
    if (invoice.createdByUserId === userId) {
      const others = await this.users.countOtherApprovers(orgId, userId);
      if (others > 0) {
        throw new ForbiddenException('The invoice creator cannot approve their own invoice');
      }
    }
    invoice.approvals.push({
      userId,
      accountId,
      decision,
      comment,
      at: new Date(),
    } as never);
    invoice.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await invoice.save();

    if (invoice.status === 'APPROVED') {
      await this.postQuietly(`invoice ${id} approved`, () =>
        this.accounting.postApApproved(invoice),
      );
    }
    return invoice.toObject();
  }

  async markPaymentPending(orgId: string, id: string, paymentId: string) {
    const invoice = await this.invoices.findOne({ _id: id, orgId });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!['APPROVED', 'PAYMENT_PENDING'].includes(invoice.status)) {
      throw new BadRequestException(`Cannot pay an invoice in status ${invoice.status}`);
    }
    invoice.status = 'PAYMENT_PENDING';
    invoice.paymentId = paymentId;
    await invoice.save();
    return invoice;
  }

  /** A failed / expired payment must not strand the invoice in PAYMENT_PENDING. */
  async resetForRetry(orgId: string, id: string) {
    const invoice = await this.invoices.findOne({ _id: id, orgId });
    if (!invoice) return null;
    if (invoice.status === 'PAYMENT_PENDING') {
      invoice.status = 'APPROVED';
      invoice.paymentId = undefined;
      await invoice.save();
    }
    return invoice;
  }

  async markPaid(orgId: string, id: string) {
    const invoice = await this.invoices.findOne({ _id: id, orgId });
    if (!invoice) return null;
    // The pollers and the refresh endpoint can call this more than once.
    if (invoice.status === 'PAID') return invoice;
    invoice.status = 'PAID';
    invoice.paidAt ??= new Date();
    await invoice.save();

    await this.postQuietly(`invoice ${id} paid`, () => this.accounting.postApPaid(invoice));
    return invoice;
  }

  async void(orgId: string, id: string) {
    const invoice = await this.invoices.findOne({ _id: id, orgId });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID') {
      throw new BadRequestException('A paid invoice cannot be voided');
    }
    // Voiding while a deposit is in flight would strand the funds.
    if (invoice.status === 'PAYMENT_PENDING') {
      throw new BadRequestException('Cancel the open payment before voiding the invoice');
    }
    const previous = invoice.status;
    invoice.status = 'VOID';
    await invoice.save();

    if (previous === 'APPROVED') {
      await this.postQuietly(`invoice ${id} voided`, () => this.accounting.postApVoid(invoice));
    }
    return invoice.toObject();
  }

  private async transition(
    orgId: string,
    id: string,
    from: string[],
    to: string,
  ) {
    const invoice = await this.invoices.findOne({ _id: id, orgId });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!from.includes(invoice.status)) {
      throw new BadRequestException(`Cannot move ${invoice.status} -> ${to}`);
    }
    invoice.status = to as never;
    await invoice.save();
    return invoice.toObject();
  }

  /** Posting must never strand a business action; `rebuild` fixes any gap. */
  private async postQuietly(label: string, post: () => Promise<unknown>) {
    try {
      await post();
    } catch (error) {
      this.logger.error(`Ledger posting failed (${label}): ${(error as Error).message}`);
    }
  }

  /** Small helper used by the demo seeder / reporting. */
  static displayTotal(invoice: { total: string; decimals: number }): string {
    return formatUnits(invoice.total, invoice.decimals);
  }
}
