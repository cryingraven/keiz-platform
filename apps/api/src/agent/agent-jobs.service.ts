import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { HireAgentInput, parseUnits } from '@keiz/shared';
import { InvoicesService } from '../invoices/invoices.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { AgentJob, AgentJobDocument } from './agent-job.schema';
import { AgentProvider, AgentProviderDocument } from './agent-provider.schema';
import { AgentWallet, AgentWalletDocument } from './agent-wallet.schema';
import { AgentService } from './agent.service';
import {
  AGENT_PROVIDER_HANDLERS,
  DEFAULT_AGENT_PROVIDERS,
} from './agent-providers';

export interface HireAgentOptions {
  /** The chat confirmation already counts as human approval. */
  approvalGranted?: boolean;
  executeNow?: boolean;
}

@Injectable()
export class AgentJobsService {
  constructor(
    @InjectModel(AgentJob.name) private readonly jobs: Model<AgentJobDocument>,
    @InjectModel(AgentProvider.name) private readonly providers: Model<AgentProviderDocument>,
    @InjectModel(AgentWallet.name) private readonly wallets: Model<AgentWalletDocument>,
    private readonly agent: AgentService,
    private readonly invoices: InvoicesService,
    private readonly receivables: ReceivablesService,
  ) {}

  private async ensureProviders() {
    await this.providers.bulkWrite(
      DEFAULT_AGENT_PROVIDERS.map((provider) => ({
        updateOne: {
          filter: { slug: provider.slug },
          update: { $setOnInsert: provider },
          upsert: true,
        },
      })),
    );
  }

  async listProviders() {
    await this.ensureProviders();
    return this.providers.find({ active: true }).sort({ priceUsd: 1 }).lean();
  }

  private async resolveProvider(identifier: string) {
    await this.ensureProviders();
    const provider = await this.providers.findOne({
      active: true,
      $or: [
        { slug: identifier.trim().toLowerCase() },
        { name: { $regex: `^${identifier.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
        { capability: identifier.trim().toLowerCase() },
      ],
    });
    if (!provider) {
      const rows = await this.providers.find({ active: true }).lean();
      throw new BadRequestException(
        `Agent provider "${identifier}" was not found. Available: ${rows
          .map((row) => `${row.name} (${row.capability})`)
          .join(', ')}`,
      );
    }
    return provider;
  }

  async listJobs(orgId: string) {
    return this.jobs.find({ orgId }).sort({ createdAt: -1 }).limit(50).lean();
  }

  async getJob(orgId: string, id: string) {
    const job = await this.jobs.findOne({ _id: id, orgId }).lean();
    if (!job) throw new NotFoundException('Agent job not found');
    return job;
  }

  async hire(
    orgId: string,
    userId: string,
    input: HireAgentInput,
    options: HireAgentOptions = {},
  ) {
    const provider = await this.resolveProvider(input.provider);
    const wallet = await this.wallets.findOne({ orgId });
    if (!wallet) throw new BadRequestException('Create an agent wallet first');
    if (wallet.provider === 'outlayer') {
      throw new BadRequestException(
        'Agent job settlement currently uses the local agent wallet. Disable OutLayer custody or use the payment rail.',
      );
    }

    const budgetUsd = input.budgetUsd ?? provider.priceUsd;
    const budgetCents = Number(parseUnits(budgetUsd, 2));
    const priceCents = Number(parseUnits(provider.priceUsd, 2));
    if (budgetCents < priceCents) {
      throw new BadRequestException(
        `Budget $${budgetUsd} is below the provider price $${provider.priceUsd}`,
      );
    }

    // Price is fixed per job for this slice. budgetUsd is the ceiling the human approved.
    const costUsd = provider.priceUsd;
    const preview = await this.agent.previewSpend(orgId, costUsd, provider.asset);
    const status = !preview.allowed
      ? 'BLOCKED'
      : preview.requiresApproval && !options.approvalGranted
        ? 'PENDING_APPROVAL'
        : 'APPROVED';

    const title = input.task.trim().slice(0, 160);
    const job = await this.jobs.create({
      orgId,
      walletId: String(wallet._id),
      providerId: String(provider._id),
      providerName: provider.name,
      capability: provider.capability,
      title,
      task: input.task,
      input: input.input ?? {},
      budgetUsd,
      costUsd,
      asset: provider.asset,
      kind: 'HIRE',
      status,
      policyDecision: { ...preview.policyDecision },
      error: status === 'BLOCKED' ? preview.reason : undefined,
      approvedByUserId: status === 'APPROVED' ? userId : undefined,
      payment: { method: 'mock', status: 'UNPAID' },
    });

    if (options.executeNow && status === 'APPROVED') {
      return this.execute(orgId, userId, String(job._id));
    }
    return job.toObject();
  }

  async approve(orgId: string, userId: string, id: string) {
    const job = await this.jobs.findOneAndUpdate(
      { _id: id, orgId, status: 'PENDING_APPROVAL' },
      { $set: { status: 'APPROVED', approvedByUserId: userId } },
      { returnDocument: 'after' },
    );
    if (!job) {
      const existing = await this.jobs.findOne({ _id: id, orgId });
      if (!existing) throw new NotFoundException('Agent job not found');
      throw new BadRequestException(`Agent job is ${existing.status}, not pending approval`);
    }
    return job.toObject();
  }

  async cancel(orgId: string, id: string) {
    const job = await this.jobs.findOneAndUpdate(
      { _id: id, orgId, status: { $in: ['QUOTED', 'PENDING_APPROVAL', 'APPROVED'] } },
      { $set: { status: 'CANCELLED' } },
      { returnDocument: 'after' },
    );
    if (!job) {
      const existing = await this.jobs.findOne({ _id: id, orgId });
      if (!existing) throw new NotFoundException('Agent job not found');
      throw new BadRequestException(`Agent job is ${existing.status}, not cancellable`);
    }
    return job.toObject();
  }

  async execute(orgId: string, userId: string, id: string) {
    const job = await this.jobs.findOneAndUpdate(
      { _id: id, orgId, status: 'APPROVED' },
      { $set: { status: 'EXECUTING' } },
      { returnDocument: 'after' },
    );
    if (!job) {
      const existing = await this.jobs.findOne({ _id: id, orgId });
      if (!existing) throw new NotFoundException('Agent job not found');
      throw new BadRequestException(`Agent job is ${existing.status}, not approved`);
    }

    const wallet = await this.wallets.findOne({ orgId });
    if (!wallet) throw new BadRequestException('Create an agent wallet first');
    if (wallet.provider === 'outlayer') {
      job.status = 'FAILED';
      job.error = 'OutLayer job settlement is not wired yet';
      await job.save();
      throw new BadRequestException(job.error);
    }

    let spend: Awaited<ReturnType<AgentService['authorizeSpend']>>;
    try {
      spend = await this.agent.authorizeSpend(orgId, job.costUsd, job.asset);
    } catch (error) {
      job.status = 'FAILED';
      job.error = error instanceof Error ? error.message : 'Could not authorize the spend';
      await job.save();
      return job.toObject();
    }
    if (!spend.allowed) {
      job.status = 'BLOCKED';
      job.error = spend.reason;
      job.policyDecision = { ...spend.policyDecision };
      await job.save();
      return job.toObject();
    }

    const handler = AGENT_PROVIDER_HANDLERS[job.capability];
    if (!handler) {
      await this.agent.releaseSpend(orgId, spend.reservedCents);
      job.status = 'FAILED';
      job.error = `No handler is registered for ${job.capability}`;
      await job.save();
      return job.toObject();
    }

    try {
      const result = await handler({
        orgId,
        input: job.input ?? {},
        invoices: this.invoices,
        receivables: this.receivables,
      });
      const paidAt = new Date();
      job.status = 'DONE';
      job.result = result.data;
      job.resultSummary = result.summary;
      job.completedAt = paidAt;
      job.payment = {
        method: 'mock',
        status: 'PAID',
        txHash: `mock:${createHash('sha256').update(`${job._id}:${randomUUID()}`).digest('hex').slice(0, 32)}`,
        paidAt,
      };
      await job.save();
      return job.toObject();
    } catch (error) {
      await this.agent.releaseSpend(orgId, spend.reservedCents);
      job.status = 'FAILED';
      job.error = error instanceof Error ? error.message : 'Agent job failed';
      job.payment = { method: 'mock', status: 'FAILED' };
      await job.save();
      return job.toObject();
    }
  }
}
