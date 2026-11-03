import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditEvent, AuditEventDocument } from './audit-event.schema';

export interface AuditEntry {
  orgId?: string;
  actorUserId?: string;
  accountId?: string;
  action: string;
  method: string;
  path: string;
  status: number;
  ip?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditEvent.name) private readonly events: Model<AuditEventDocument>,
  ) {}

  /** Never throws: auditing must not break the request it is recording. */
  async record(entry: AuditEntry) {
    try {
      await this.events.create(entry);
    } catch (error) {
      this.logger.warn(`Audit write failed: ${(error as Error).message}`);
    }
  }

  list(orgId: string, limit = 100) {
    return this.events.find({ orgId }).sort({ createdAt: -1 }).limit(limit).lean();
  }
}
