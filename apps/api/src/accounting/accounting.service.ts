import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ACCOUNT_CODES,
  AccountType,
  CURRENCY_DECIMALS,
  CHART_OF_ACCOUNTS,
  JournalEvent,
  JournalSourceType,
  ManualJournalInput,
  NormalBalance,
  parseUnits,
  signedBalance,
} from '@keiz/shared';
import { Invoice, InvoiceDocument } from '../invoices/invoice.schema';
import { Receivable, ReceivableDocument } from '../receivables/receivable.schema';
import { Account, AccountDocument } from './account.schema';
import {
  BillForLedger,
  PostingLine,
  ReceivableForLedger,
  ReceiptForLedger,
  apApprovedLines,
  apPaidLines,
  arIssuedLines,
  arReceiptLines,
  assertBalanced,
  invertLines,
} from './accounting.rules';
import { JournalEntry, JournalEntryDocument } from './journal-entry.schema';

export interface PostingInput {
  date: Date;
  memo: string;
  sourceType: JournalSourceType;
  sourceId: string;
  event: JournalEvent;
  currency: string;
  decimals: number;
  lines: PostingLine[];
  dedupeKey?: string;
  postedByUserId?: string;
  reversalOf?: string;
}

export interface PostingResult {
  entry: JournalEntryDocument;
  created: boolean;
}

export interface AccountRow {
  _id: Types.ObjectId;
  orgId: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  archived: boolean;
}

interface RawTotals {
  debit: bigint;
  credit: bigint;
}

const DAY = 86_400_000;

function startOfDay(value: Date | string): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date | string): Date {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function startOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function signOf(normalBalance: NormalBalance, totals: RawTotals | undefined): bigint {
  const debit = totals?.debit ?? 0n;
  const credit = totals?.credit ?? 0n;
  return signedBalance(normalBalance, debit, credit);
}

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    @InjectModel(Account.name) private readonly accounts: Model<AccountDocument>,
    @InjectModel(JournalEntry.name) private readonly entries: Model<JournalEntryDocument>,
    @InjectModel(Invoice.name) private readonly invoices: Model<InvoiceDocument>,
    @InjectModel(Receivable.name) private readonly receivables: Model<ReceivableDocument>,
  ) {}

  /** Idempotently seed the default chart for a workspace. */
  async ensureChart(orgId: string): Promise<AccountRow[]> {
    const operations = CHART_OF_ACCOUNTS.map((account) => ({
      updateOne: {
        filter: { orgId, code: account.code },
        update: {
          $setOnInsert: {
            orgId,
            code: account.code,
            name: account.name,
            type: account.type,
            normalBalance: account.normalBalance,
            system: true,
            archived: false,
          },
        },
        upsert: true,
      },
    }));
    try {
      await this.accounts.bulkWrite(operations, { ordered: false });
    } catch (error) {
      // Two concurrent first postings can race on the upsert; the unique index wins.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    return (await this.accounts.find({ orgId }).sort({ code: 1 }).lean()) as unknown as AccountRow[];
  }

  async listAccounts(orgId: string) {
    return this.ensureChart(orgId);
  }

  /**
   * Validate and persist one balanced journal entry. The dedupeKey unique index
   * makes every system posting idempotent; retries return the existing entry.
   */
  async post(orgId: string, input: PostingInput): Promise<PostingResult> {
    const lines = input.lines.filter((line) => line.debit !== 0n || line.credit !== 0n);
    if (lines.length < 2) {
      throw new BadRequestException('A journal entry needs at least two non-zero lines');
    }

    for (const line of lines) {
      if (line.debit < 0n || line.credit < 0n) {
        throw new BadRequestException('Journal amounts cannot be negative');
      }
      if (line.debit > 0n && line.credit > 0n) {
        throw new BadRequestException('A journal line cannot be both a debit and a credit');
      }
    }
    try {
      assertBalanced(lines);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const chart = await this.ensureChart(orgId);
    const byCode = new Map(chart.map((account) => [account.code, account]));

    const docs = lines.map((line) => {
      const account = byCode.get(line.accountCode);
      if (!account) {
        throw new BadRequestException(`Unknown account code ${line.accountCode}`);
      }
      return {
        accountId: String(account._id),
        accountCode: account.code,
        accountName: account.name,
        debit: line.debit.toString(),
        credit: line.credit.toString(),
      };
    });

    try {
      const entry = await this.entries.create({
        orgId,
        date: input.date,
        memo: input.memo,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        event: input.event,
        currency: input.currency,
        decimals: input.decimals,
        dedupeKey: input.dedupeKey,
        reversalOf: input.reversalOf ? new Types.ObjectId(input.reversalOf) : undefined,
        postedByUserId: input.postedByUserId,
        lines: docs,
      });
      return { entry, created: true };
    } catch (error) {
      if ((error as { code?: number }).code === 11000 && input.dedupeKey) {
        const existing = await this.entries.findOne({ orgId, dedupeKey: input.dedupeKey });
        if (existing) return { entry: existing, created: false };
      }
      throw error;
    }
  }

  async postApApproved(invoice: BillForLedger): Promise<PostingResult> {
    const id = String(invoice._id);
    return this.post(invoice.orgId, {
      date: invoice.issueDate,
      memo: `Vendor bill ${invoice.number} approved`,
      sourceType: 'invoice',
      sourceId: id,
      event: 'APPROVED',
      currency: invoice.currency,
      decimals: invoice.decimals,
      dedupeKey: `invoice:${id}:APPROVED`,
      lines: apApprovedLines(invoice),
    });
  }

  async postApPaid(invoice: BillForLedger): Promise<PostingResult> {
    const id = String(invoice._id);
    return this.post(invoice.orgId, {
      date: invoice.paidAt ?? new Date(),
      memo: `Vendor bill ${invoice.number} paid`,
      sourceType: 'invoice',
      sourceId: id,
      event: 'PAID',
      currency: invoice.currency,
      decimals: invoice.decimals,
      dedupeKey: `invoice:${id}:PAID`,
      lines: apPaidLines(invoice),
    });
  }

  async postApVoid(invoice: BillForLedger): Promise<PostingResult | null> {
    const id = String(invoice._id);
    return this.reverseByKey(invoice.orgId, {
      originalKey: `invoice:${id}:APPROVED`,
      memo: `Vendor bill ${invoice.number} voided`,
      sourceType: 'invoice',
      sourceId: id,
      event: 'VOID',
      dedupeKey: `invoice:${id}:VOID`,
      date: new Date(),
    });
  }

  async postArIssued(receivable: ReceivableForLedger): Promise<PostingResult> {
    const id = String(receivable._id);
    return this.post(receivable.orgId, {
      date: receivable.issueDate,
      memo: `Customer invoice ${receivable.number} issued`,
      sourceType: 'receivable',
      sourceId: id,
      event: 'ISSUED',
      currency: receivable.currency,
      decimals: receivable.decimals,
      dedupeKey: `receivable:${id}:ISSUED`,
      lines: arIssuedLines(receivable),
    });
  }

  async postArReceipt(
    receivable: ReceivableForLedger,
    receipt: ReceiptForLedger,
  ): Promise<PostingResult> {
    return this.post(receivable.orgId, {
      date: new Date(receipt.receivedAt),
      memo: `Receipt for ${receivable.number}`,
      sourceType: 'receipt',
      sourceId: receipt.receiptId,
      event: 'RECEIVED',
      currency: receipt.currency ?? receivable.currency,
      decimals: receipt.decimals ?? receivable.decimals,
      dedupeKey: `receipt:${receipt.receiptId}:RECEIVED`,
      lines: arReceiptLines(receipt),
    });
  }

  async postArVoid(receivable: ReceivableForLedger): Promise<PostingResult | null> {
    const id = String(receivable._id);
    return this.reverseByKey(receivable.orgId, {
      originalKey: `receivable:${id}:ISSUED`,
      memo: `Customer invoice ${receivable.number} voided`,
      sourceType: 'receivable',
      sourceId: id,
      event: 'VOID',
      dedupeKey: `receivable:${id}:VOID`,
      date: new Date(),
    });
  }

  async postManual(
    orgId: string,
    userId: string,
    input: ManualJournalInput,
  ): Promise<JournalEntryDocument> {
    const decimals = CURRENCY_DECIMALS[input.currency] ?? 2;
    const lines = input.lines.map((line) => {
      let debit: bigint;
      let credit: bigint;
      try {
        debit = parseUnits(line.debit || '0', decimals);
        credit = parseUnits(line.credit || '0', decimals);
      } catch {
        throw new BadRequestException(
          `Account ${line.accountCode} has an amount with more than ${decimals} decimal places`,
        );
      }
      if (debit > 0n && credit > 0n) {
        throw new BadRequestException('A journal line cannot be both a debit and a credit');
      }
      return { accountCode: line.accountCode, debit, credit };
    });

    const result = await this.post(orgId, {
      date: input.date ? new Date(input.date) : new Date(),
      memo: input.memo,
      sourceType: 'manual',
      sourceId: new Types.ObjectId().toString(),
      event: 'MANUAL',
      currency: input.currency,
      decimals,
      lines,
      postedByUserId: userId,
    });
    return result.entry;
  }

  /** Demo/bootstrap opening cash. Idempotent per org and currency. */
  async postOpeningBalance(
    orgId: string,
    currency: string,
    amount: bigint,
    decimals = 2,
  ): Promise<PostingResult> {
    if (amount <= 0n) throw new BadRequestException('Opening balance must be positive');
    return this.post(orgId, {
      date: new Date(),
      memo: 'Opening balance',
      sourceType: 'opening',
      sourceId: orgId,
      event: 'OPENING',
      currency,
      decimals,
      dedupeKey: `opening:${orgId}:${currency}`,
      lines: [
        { accountCode: ACCOUNT_CODES.CASH, debit: amount, credit: 0n },
        { accountCode: ACCOUNT_CODES.RETAINED_EARNINGS, debit: 0n, credit: amount },
      ],
    });
  }

  private async reverseByKey(
    orgId: string,
    options: {
      originalKey: string;
      memo: string;
      sourceType: JournalSourceType;
      sourceId: string;
      event: JournalEvent;
      dedupeKey: string;
      date: Date;
    },
  ): Promise<PostingResult | null> {
    const original = await this.entries.findOne({ orgId, dedupeKey: options.originalKey });
    if (!original) return null;
    return this.post(orgId, {
      date: options.date,
      memo: options.memo,
      sourceType: options.sourceType,
      sourceId: options.sourceId,
      event: options.event,
      currency: original.currency,
      decimals: original.decimals,
      dedupeKey: options.dedupeKey,
      reversalOf: String(original._id),
      lines: invertLines(
        original.lines.map((line) => ({
          accountCode: line.accountCode,
          debit: BigInt(line.debit),
          credit: BigInt(line.credit),
        })),
      ),
    });
  }

  async summary(orgId: string, query: { currency?: string; from?: string; to?: string }) {
    const currency = query.currency ?? 'USD';
    const decimals = CURRENCY_DECIMALS[currency] ?? 2;
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : startOfMonth(to);

    const [chart, balances, period, currencies] = await Promise.all([
      this.ensureChart(orgId),
      this.aggregateRaw(orgId, currency, undefined, to),
      this.aggregateRaw(orgId, currency, from, to),
      this.entries.distinct('currency', { orgId }),
    ]);

    const account = (code: string) => chart.find((row) => row.code === code);
    const balance = (code: string) => {
      const row = account(code);
      return row ? signOf(row.normalBalance, balances.get(code)).toString() : '0';
    };
    const periodNet = (code: string) => {
      const row = account(code);
      return row ? signOf(row.normalBalance, period.get(code)).toString() : '0';
    };

    let totalDebit = 0n;
    let totalCredit = 0n;
    const rows = chart.map((row) => {
      const totals = balances.get(row.code) ?? { debit: 0n, credit: 0n };
      totalDebit += totals.debit;
      totalCredit += totals.credit;
      return {
        code: row.code,
        name: row.name,
        type: row.type,
        normalBalance: row.normalBalance,
        debit: totals.debit.toString(),
        credit: totals.credit.toString(),
        balance: signOf(row.normalBalance, totals).toString(),
      };
    });

    const revenue = periodNet(ACCOUNT_CODES.REVENUE);
    const expenses = (
      BigInt(periodNet(ACCOUNT_CODES.OPERATING_EXPENSES)) +
      BigInt(periodNet(ACCOUNT_CODES.FEES))
    ).toString();

    return {
      currency,
      decimals,
      from: from.toISOString(),
      to: to.toISOString(),
      cash: balance(ACCOUNT_CODES.CASH),
      receivable: balance(ACCOUNT_CODES.RECEIVABLE),
      payable: balance(ACCOUNT_CODES.PAYABLE),
      inputTax: balance(ACCOUNT_CODES.INPUT_TAX),
      taxPayable: balance(ACCOUNT_CODES.TAX_PAYABLE),
      revenue,
      expenses,
      netIncome: (BigInt(revenue) - BigInt(expenses)).toString(),
      availableCurrencies: Array.from(new Set(['USD', ...currencies])).sort(),
      trialBalance: {
        rows,
        totals: {
          debit: totalDebit.toString(),
          credit: totalCredit.toString(),
          balanced: totalDebit === totalCredit,
        },
      },
    };
  }

  async trialBalance(
    orgId: string,
    query: { currency?: string; asOf?: string },
  ) {
    const currency = query.currency ?? 'USD';
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const [chart, totals] = await Promise.all([
      this.ensureChart(orgId),
      this.aggregateRaw(orgId, currency, undefined, asOf),
    ]);

    let totalDebit = 0n;
    let totalCredit = 0n;
    const rows = chart.map((row) => {
      const value = totals.get(row.code) ?? { debit: 0n, credit: 0n };
      totalDebit += value.debit;
      totalCredit += value.credit;
      return {
        code: row.code,
        name: row.name,
        type: row.type,
        normalBalance: row.normalBalance,
        debit: value.debit.toString(),
        credit: value.credit.toString(),
        balance: signOf(row.normalBalance, value).toString(),
      };
    });

    return {
      currency,
      decimals: CURRENCY_DECIMALS[currency] ?? 2,
      asOf: asOf.toISOString(),
      rows,
      totals: {
        debit: totalDebit.toString(),
        credit: totalCredit.toString(),
        balanced: totalDebit === totalCredit,
      },
    };
  }

  async journal(
    orgId: string,
    query: {
      currency?: string;
      from?: string;
      to?: string;
      accountCode?: string;
      sourceType?: JournalSourceType;
      sourceId?: string;
      limit?: number;
    },
  ) {
    const filter: Record<string, unknown> = { orgId };
    if (query.currency) filter.currency = query.currency;
    if (query.sourceType) filter.sourceType = query.sourceType;
    if (query.sourceId) filter.sourceId = query.sourceId;
    if (query.accountCode) filter['lines.accountCode'] = query.accountCode;
    if (query.from || query.to) {
      const date: Record<string, Date> = {};
      if (query.from) date.$gte = startOfDay(query.from);
      if (query.to) date.$lte = endOfDay(query.to);
      filter.date = date;
    }
    return this.entries
      .find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(query.limit ?? 100)
      .lean();
  }

  async aging(orgId: string, side: 'AP' | 'AR', currency: string) {
    const buckets = [
      { key: 'current', label: 'Not due', count: 0, amount: 0n },
      { key: '1_30', label: '1–30 days', count: 0, amount: 0n },
      { key: '31_60', label: '31–60 days', count: 0, amount: 0n },
      { key: '61_plus', label: '60+ days', count: 0, amount: 0n },
    ];
    const today = startOfDay(new Date());

    if (side === 'AP') {
      const rows = await this.invoices
        .find({ orgId, currency, status: { $in: ['APPROVED', 'PAYMENT_PENDING'] } })
        .lean();
      for (const row of rows) {
        const bucket = bucketFor(row.dueDate, today);
        const entry = buckets.find((item) => item.key === bucket)!;
        entry.count += 1;
        entry.amount += BigInt(row.total);
      }
    } else {
      const rows = await this.receivables
        .find({ orgId, currency, status: { $in: ['ISSUED', 'PARTIALLY_PAID'] } })
        .lean();
      for (const row of rows) {
        const bucket = bucketFor(row.dueDate, today);
        const entry = buckets.find((item) => item.key === bucket)!;
        entry.count += 1;
        entry.amount += BigInt(row.total) - BigInt(row.paidAmount);
      }
    }

    return {
      side,
      currency,
      decimals: CURRENCY_DECIMALS[currency] ?? 2,
      buckets: buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        count: bucket.count,
        amount: bucket.amount.toString(),
      })),
      total: buckets.reduce((sum, bucket) => sum + bucket.amount, 0n).toString(),
    };
  }

  /**
   * Backfill missing postings from the AP/AR documents. Safe to run repeatedly:
   * every system entry carries a deterministic dedupe key.
   */
  async rebuild(orgId: string) {
    const [invoices, receivables] = await Promise.all([
      this.invoices.find({ orgId }).lean(),
      this.receivables.find({ orgId }).lean(),
    ]);

    let created = 0;
    let failed = 0;

    for (const invoice of invoices) {
      try {
        if (['APPROVED', 'PAYMENT_PENDING', 'PAID'].includes(invoice.status)) {
          if ((await this.postApApproved(invoice)).created) created += 1;
        }
        if (invoice.status === 'PAID' && (await this.postApPaid(invoice)).created) created += 1;
        if (invoice.status === 'VOID') {
          const result = await this.postApVoid(invoice);
          if (result?.created) created += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Ledger rebuild failed for invoice ${String(invoice._id)}: ${(error as Error).message}`,
        );
      }
    }

    for (const receivable of receivables) {
      try {
        if (['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(receivable.status)) {
          if ((await this.postArIssued(receivable)).created) created += 1;
        }
        for (const receipt of receivable.receipts ?? []) {
          if ((await this.postArReceipt(receivable, receipt)).created) created += 1;
        }
        if (receivable.status === 'VOID') {
          const result = await this.postArVoid(receivable);
          if (result?.created) created += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Ledger rebuild failed for receivable ${String(receivable._id)}: ${(error as Error).message}`,
        );
      }
    }

    return {
      created,
      failed,
      invoices: invoices.length,
      receivables: receivables.length,
    };
  }

  /** Internal: raw debit/credit totals per account for a date window. */
  async aggregateRaw(
    orgId: string,
    currency: string,
    from?: Date,
    to?: Date,
  ): Promise<Map<string, RawTotals>> {
    const match: Record<string, unknown> = { orgId, currency };
    if (from || to) {
      const date: Record<string, Date> = {};
      if (from) date.$gte = startOfDay(from);
      if (to) date.$lte = endOfDay(to);
      match.date = date;
    }

    const rows = await this.entries
      .aggregate<{ _id: string; debit: unknown; credit: unknown }>([
        { $match: match },
        { $unwind: '$lines' },
        {
          $group: {
            _id: '$lines.accountCode',
            debit: { $sum: { $toDecimal: '$lines.debit' } },
            credit: { $sum: { $toDecimal: '$lines.credit' } },
          },
        },
      ])
      .exec();

    const totals = new Map<string, RawTotals>();
    for (const row of rows) {
      totals.set(row._id, {
        debit: BigInt(String(row.debit)),
        credit: BigInt(String(row.credit)),
      });
    }
    return totals;
  }
}

function bucketFor(dueDate: Date, today: Date): string {
  const due = startOfDay(dueDate).getTime();
  const diff = Math.floor((today.getTime() - due) / DAY);
  if (diff <= 0) return 'current';
  if (diff <= 30) return '1_30';
  if (diff <= 60) return '31_60';
  return '61_plus';
}
