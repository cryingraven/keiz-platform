import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ACCOUNT_CODES, CURRENCY_DECIMALS, ReportQuery } from '@keiz/shared';
import { AccountingService } from './accounting.service';
import { JournalEntry, JournalEntryDocument } from './journal-entry.schema';
import {
  buildBalanceSheet,
  buildCashFlow,
  buildProfitAndLoss,
  CashSourceRow,
} from './reporting.rules';

export interface FinancialReport {
  currency: string;
  decimals: number;
  from: string;
  to: string;
  availableCurrencies: string[];
  cashFlow: ReturnType<typeof buildCashFlow>;
  profitAndLoss: ReturnType<typeof buildProfitAndLoss>;
  balanceSheet: ReturnType<typeof buildBalanceSheet> & { asOf: string };
}

function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function startOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

@Injectable()
export class ReportingService {
  constructor(
    @InjectModel(JournalEntry.name)
    private readonly entries: Model<JournalEntryDocument>,
    private readonly accounting: AccountingService,
  ) {}

  async build(orgId: string, query: ReportQuery): Promise<FinancialReport> {
    const currency = query.currency ?? 'USD';
    const to = endOfDay(query.to ? new Date(query.to) : new Date());
    const from = startOfDay(query.from ? new Date(query.from) : startOfMonth(to));

    const [chart, periodTotals, cumulativeTotals, cashRows, currencies] = await Promise.all([
      this.accounting.ensureChart(orgId),
      this.accounting.aggregateRaw(orgId, currency, from, to),
      this.accounting.aggregateRaw(orgId, currency, undefined, to),
      this.cashRows(orgId, currency, from, to),
      this.entries.distinct('currency', { orgId }),
    ]);

    return {
      currency,
      decimals: CURRENCY_DECIMALS[currency] ?? 2,
      from: from.toISOString(),
      to: to.toISOString(),
      availableCurrencies: Array.from(new Set(['USD', ...currencies])).sort(),
      cashFlow: buildCashFlow(cashRows),
      profitAndLoss: buildProfitAndLoss(chart, periodTotals),
      balanceSheet: {
        ...buildBalanceSheet(chart, cumulativeTotals),
        asOf: to.toISOString(),
      },
    };
  }

  private async cashRows(
    orgId: string,
    currency: string,
    from: Date,
    to: Date,
  ): Promise<CashSourceRow[]> {
    return this.entries
      .aggregate<CashSourceRow>([
        { $match: { orgId, currency, date: { $gte: from, $lte: to } } },
        { $unwind: '$lines' },
        { $match: { 'lines.accountCode': ACCOUNT_CODES.CASH } },
        {
          $group: {
            _id: { sourceType: '$sourceType', event: '$event' },
            inflow: { $sum: { $toDecimal: '$lines.debit' } },
            outflow: { $sum: { $toDecimal: '$lines.credit' } },
          },
        },
        {
          $project: {
            _id: 0,
            sourceType: '$_id.sourceType',
            event: '$_id.event',
            inflow: { $toString: '$inflow' },
            outflow: { $toString: '$outflow' },
          },
        },
      ])
      .exec();
  }
}
