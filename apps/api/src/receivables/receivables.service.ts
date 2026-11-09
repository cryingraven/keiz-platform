import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  CURRENCY_DECIMALS,
  CreateCustomerInput,
  CreateReceivableInput,
  RecordReceiptInput,
  UpdateCustomerInput,
  computeInvoiceTotals,
  parseUnits,
} from '@keiz/shared';
import { AccountingService } from '../accounting/accounting.service';
import { Customer, CustomerDocument } from './customer.schema';
import { Receivable, ReceivableDocument } from './receivable.schema';

@Injectable()
export class ReceivablesService {
  private readonly logger = new Logger(ReceivablesService.name);

  constructor(
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(Receivable.name) private readonly receivables: Model<ReceivableDocument>,
    private readonly accounting: AccountingService,
  ) {}

  listCustomers(orgId: string, options: { includeArchived?: boolean; query?: string } = {}) {
    const filter: Record<string, unknown> = { orgId };
    if (!options.includeArchived) filter.status = 'ACTIVE';
    const query = options.query?.trim();
    if (query) {
      filter.$or = [
        { name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { email: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      ];
    }
    return this.customers.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }

  async createCustomer(orgId: string, input: CreateCustomerInput) {
    return this.customers.create({ ...input, orgId });
  }

  async findCustomer(orgId: string, id: string) {
    const customer = await this.customers.findOne({ _id: id, orgId }).lean();
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async updateCustomer(orgId: string, id: string, input: UpdateCustomerInput) {
    const customer = await this.customers.findOneAndUpdate(
      { _id: id, orgId },
      { $set: input },
      { returnDocument: 'after' },
    );
    if (!customer) throw new NotFoundException('Customer not found');
    return customer.toObject();
  }

  async archiveCustomer(orgId: string, id: string) {
    const customer = await this.customers.findOneAndUpdate(
      { _id: id, orgId },
      { $set: { status: 'ARCHIVED' } },
      { returnDocument: 'after' },
    );
    if (!customer) throw new NotFoundException('Customer not found');
    return customer.toObject();
  }

  async restoreCustomer(orgId: string, id: string) {
    const customer = await this.customers.findOneAndUpdate(
      { _id: id, orgId },
      { $set: { status: 'ACTIVE' } },
      { returnDocument: 'after' },
    );
    if (!customer) throw new NotFoundException('Customer not found');
    return customer.toObject();
  }

  list(orgId: string, query: { status?: string; customerId?: string; currency?: string }) {
    const filter: Record<string, unknown> = { orgId };
    if (query.status) filter.status = query.status;
    if (query.customerId) filter.customerId = query.customerId;
    if (query.currency) filter.currency = query.currency;
    return this.receivables.find(filter).sort({ dueDate: 1, createdAt: -1 }).lean();
  }

  async summary(orgId: string, currency = 'USD') {
    const rows = await this.receivables.find({ orgId, currency }).lean();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let outstanding = 0n;
    let overdue = 0n;
    let collected = 0n;
    let billed = 0n;
    let openCount = 0;

    for (const row of rows) {
      if (row.status === 'DRAFT' || row.status === 'VOID') continue;
      billed += BigInt(row.total);
      collected += BigInt(row.paidAmount);
      if (row.status === 'ISSUED' || row.status === 'PARTIALLY_PAID') {
        const remaining = BigInt(row.total) - BigInt(row.paidAmount);
        outstanding += remaining;
        openCount += 1;
        if (row.dueDate.getTime() < today.getTime()) overdue += remaining;
      }
    }

    return {
      currency,
      decimals: CURRENCY_DECIMALS[currency] ?? 2,
      billed: billed.toString(),
      collected: collected.toString(),
      outstanding: outstanding.toString(),
      overdue: overdue.toString(),
      openCount,
      totalCount: rows.length,
    };
  }

  async create(orgId: string, userId: string, input: CreateReceivableInput) {
    await this.findCustomer(orgId, input.customerId);
    const decimals = CURRENCY_DECIMALS[input.currency] ?? 2;
    let totals: ReturnType<typeof computeInvoiceTotals>;
    try {
      totals = computeInvoiceTotals(input.lineItems, decimals, input.taxBps);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    try {
      const receivable = await this.receivables.create({
        orgId,
        customerId: input.customerId,
        number: input.number,
        issueDate: input.issueDate ? new Date(input.issueDate) : new Date(),
        dueDate: new Date(input.dueDate),
        currency: input.currency,
        decimals,
        lineItems: totals.lines,
        subtotal: totals.subtotal,
        taxBps: input.taxBps,
        taxAmount: totals.taxAmount,
        total: totals.total,
        paidAmount: '0',
        status: 'DRAFT',
        notes: input.notes,
        createdByUserId: userId,
      });
      return receivable.toObject();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(`Receivable ${input.number} already exists`);
      }
      throw error;
    }
  }

  async findOne(orgId: string, id: string) {
    const receivable = await this.receivables.findOne({ _id: id, orgId }).lean();
    if (!receivable) throw new NotFoundException('Receivable not found');
    return receivable;
  }

  async findByNumber(orgId: string, number: string) {
    return this.receivables.findOne({ orgId, number }).lean();
  }

  async hasChainEvent(orgId: string, chainEventId: string) {
    const hit = await this.receivables.exists({
      orgId,
      'receipts.chainEventId': chainEventId,
    });
    return Boolean(hit);
  }

  async issue(orgId: string, id: string) {
    const receivable = await this.receivables.findOne({ _id: id, orgId });
    if (!receivable) throw new NotFoundException('Receivable not found');
    if (receivable.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot issue a receivable in status ${receivable.status}`);
    }
    receivable.status = 'ISSUED';
    receivable.issuedAt = new Date();
    await receivable.save();

    await this.postQuietly(`receivable ${id} issued`, () =>
      this.accounting.postArIssued(receivable),
    );
    return receivable.toObject();
  }

  async recordReceipt(
    orgId: string,
    userId: string,
    id: string,
    input: RecordReceiptInput,
  ) {
    const receivable = await this.receivables.findOne({ _id: id, orgId });
    if (!receivable) throw new NotFoundException('Receivable not found');
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(receivable.status)) {
      throw new BadRequestException(`Cannot record a receipt for a ${receivable.status} receivable`);
    }

    let amount: bigint;
    try {
      amount = parseUnits(input.amount, receivable.decimals);
    } catch {
      throw new BadRequestException(
        `Receipt amount must fit ${receivable.decimals} decimal places`,
      );
    }
    if (amount <= 0n) throw new BadRequestException('Receipt amount must be positive');

    const current = BigInt(receivable.paidAmount);
    const total = BigInt(receivable.total);
    const next = current + amount;
    if (next > total) {
      throw new BadRequestException('Receipt exceeds the outstanding amount');
    }

    const receipt = {
      receiptId: randomUUID(),
      amount: amount.toString(),
      currency: receivable.currency,
      decimals: receivable.decimals,
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
      method: input.method,
      reference: input.reference,
      txHash: input.txHash,
      chainEventId: input.chainEventId,
      receivableRef: input.receivableRef,
      tokenContract: input.tokenContract,
      sender: input.sender,
      recordedByUserId: userId,
    };

    // Optimistic lock on paidAmount: two concurrent receipts cannot both pass.
    const updated = await this.receivables.findOneAndUpdate(
      { _id: receivable._id, orgId, paidAmount: receivable.paidAmount },
      {
        $set: {
          paidAmount: next.toString(),
          status: next === total ? 'PAID' : 'PARTIALLY_PAID',
        },
        $push: { receipts: receipt },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      throw new ConflictException('Receivable changed while recording the receipt; retry');
    }

    await this.postQuietly(`receipt ${receipt.receiptId}`, () =>
      this.accounting.postArReceipt(updated, receipt),
    );
    return updated.toObject();
  }

  async void(orgId: string, id: string) {
    const receivable = await this.receivables.findOne({ _id: id, orgId });
    if (!receivable) throw new NotFoundException('Receivable not found');
    if (receivable.status === 'PAID') {
      throw new BadRequestException('A paid receivable cannot be voided');
    }
    if (receivable.status === 'VOID') return receivable.toObject();
    if ((receivable.receipts?.length ?? 0) > 0) {
      throw new BadRequestException('Reverse the recorded receipts before voiding');
    }

    receivable.status = 'VOID';
    receivable.voidedAt = new Date();
    await receivable.save();

    await this.postQuietly(`receivable ${id} voided`, () =>
      this.accounting.postArVoid(receivable),
    );
    return receivable.toObject();
  }

  private async postQuietly(label: string, post: () => Promise<unknown>) {
    try {
      await post();
    } catch (error) {
      this.logger.error(`Ledger posting failed (${label}): ${(error as Error).message}`);
    }
  }
}
