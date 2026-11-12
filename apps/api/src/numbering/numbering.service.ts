import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DocumentKind, documentPeriod, formatDocumentNumber } from '@keiz/shared';
import { DocumentCounter, DocumentCounterDocument } from './document-counter.schema';

@Injectable()
export class NumberingService {
  constructor(
    @InjectModel(DocumentCounter.name)
    private readonly counters: Model<DocumentCounterDocument>,
  ) {}

  /**
   * Reserve the next number for a kind in the business-date month.
   * Allocation is atomic per `(org, kind, period)`; a failed document insert
   * leaves a gap, which is normal for document series.
   */
  async next(
    orgId: string,
    kind: DocumentKind,
    date: Date | string = new Date(),
  ): Promise<string> {
    const period = documentPeriod(date);
    const seq = await this.increment(orgId, kind, period, true);
    return formatDocumentNumber(kind, date, seq);
  }

  private async increment(
    orgId: string,
    kind: DocumentKind,
    period: string,
    retry: boolean,
  ): Promise<number> {
    try {
      const counter = await this.counters
        .findOneAndUpdate(
          { orgId, kind, period },
          { $inc: { seq: 1 } },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        )
        .lean();
      if (!counter) throw new Error('Could not allocate a document number');
      return counter.seq;
    } catch (error) {
      // Two requests can race to create a fresh monthly counter. The loser
      // retries once against the row the winner inserted.
      if (retry && (error as { code?: number }).code === 11000) {
        return this.increment(orgId, kind, period, false);
      }
      throw error;
    }
  }
}
