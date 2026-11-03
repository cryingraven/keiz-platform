import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CURRENCY_DECIMALS,
  CreateInvoiceInput,
  applyBps,
  formatUnits,
  parseUnits,
  sumAmounts,
} from '@keiz/shared';
import { UsersService } from '../users/users.service';
import { Invoice, InvoiceDocument } from './invoice.schema';

const QUANTITY_SCALE = 6;

function lineTotal(quantity: string, unitPrice: string, decimals: number): bigint {
  // quantity is unitless (hours, units) and allowed 6dp; price is in currency units.
  const qty = parseUnits(quantity, QUANTITY_SCALE);
  const price = parseUnits(unitPrice, decimals);
  return (qty * price) / 10n ** BigInt(QUANTITY_SCALE);
}

@Injectable()
export class InvoicesService {
  constructor(
    @InjectModel(Invoice.name) private readonly invoices: Model<InvoiceDocument>,
    private readonly users: UsersService,
  ) {}

  async list(orgId: string, status?: string) {
    const filter: Record<string, unknown> = { orgId };
    if (status) filter.status = status;
    return this.invoices.find(filter).sort({ createdAt: -1 }).lean();
  }

  async summary(orgId: string) {
    const rows = await this.invoices
      .aggregate<{ _id: string; count: number; total: number }>([
        { $match: { orgId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            total: { $sum: { $toDouble: '$total' } },
          },
        },
      ])
      .exec();
    return rows;
  }

  async create(orgId: string, userId: string, input: CreateInvoiceInput) {
    const decimals = CURRENCY_DECIMALS[input.currency] ?? 2;
    const lines = input.lineItems.map((item) => ({
      ...item,
      lineTotal: lineTotal(item.quantity, item.unitPrice, decimals).toString(),
    }));
    const subtotal = sumAmounts(lines.map((line) => BigInt(line.lineTotal)));
    const taxAmount = applyBps(subtotal, input.taxBps);
    const total = subtotal + taxAmount;

    const invoice = await this.invoices.create({
      orgId,
      vendorId: input.vendorId,
      number: input.number,
      issueDate: input.issueDate ? new Date(input.issueDate) : new Date(),
      dueDate: new Date(input.dueDate),
      currency: input.currency,
      decimals,
      lineItems: lines,
      subtotal: subtotal.toString(),
      taxBps: input.taxBps,
      taxAmount: taxAmount.toString(),
      total: total.toString(),
      status: 'DRAFT',
      notes: input.notes,
      createdByUserId: userId,
    });
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
    invoice.status = 'PAID';
    invoice.paidAt = new Date();
    await invoice.save();
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
    invoice.status = 'VOID';
    await invoice.save();
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

  /** Small helper used by the demo seeder / reporting. */
  static displayTotal(invoice: { total: string; decimals: number }): string {
    return formatUnits(invoice.total, invoice.decimals);
  }
}
