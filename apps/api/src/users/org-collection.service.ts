import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'node:crypto';
import { OrgCollectionInput } from '@keiz/shared';
import { fetchRpcWithRetry } from '../common/rpc-client';
import { walletNetwork } from '../common/network';
import { Organization, OrganizationCollection, OrganizationDocument } from './organization.schema';

@Injectable()
export class OrgCollectionService {
  constructor(
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    private readonly config: ConfigService,
  ) {}

  async get(orgId: string): Promise<OrganizationCollection | null> {
    const org = await this.orgs.findById(orgId).lean();
    if (!org) throw new NotFoundException('Workspace not found');
    return org.collection ?? null;
  }

  async update(orgId: string, input: OrgCollectionInput): Promise<OrganizationCollection> {
    const org = await this.orgs.findById(orgId);
    if (!org) throw new NotFoundException('Workspace not found');
    const network = org.network ?? walletNetwork(this.config);
    await this.validate(orgId, network, input);
    const collection = {
      ...input,
      network,
      status: input.status,
      deployedAt: org.collection?.deployedAt ?? new Date(),
      validatedAt: new Date(),
    };
    org.set('collection', collection);
    await org.save();
    return org.collection ?? collection;
  }

  async validate(orgId: string, network: 'mainnet' | 'testnet', input: OrgCollectionInput) {
    const rpcUrl =
      network === 'testnet'
        ? this.config.get<string>('NEAR_AUTH_RPC_URL') || 'https://rpc.testnet.near.org'
        : this.config.get<string>('NEAR_RPC_URL') || 'https://free.rpc.fastnear.com';

    const contractOrg = await this.view<string>(rpcUrl, input.contractId, 'get_org_id', {});
    if (String(contractOrg) !== orgId) {
      throw new BadRequestException(
        'The contract belongs to a different workspace (get_org_id mismatch)',
      );
    }
    const treasury = await this.view<string>(rpcUrl, input.contractId, 'get_treasury', {});
    if (String(treasury) !== input.treasury) {
      throw new BadRequestException('The contract treasury does not match the configured treasury');
    }
    const allowed = await this.view<boolean>(rpcUrl, input.contractId, 'is_token_allowed', {
      token: input.tokenContract,
    });
    if (!allowed) {
      throw new BadRequestException('The token is not allowlisted in the collect contract');
    }

    const expectedHash = this.config.get<string>('KEIZ_COLLECT_CODE_HASH');
    if (!expectedHash && this.config.get<string>('NODE_ENV') === 'production') {
      throw new BadRequestException(
        'KEIZ_COLLECT_CODE_HASH must be configured before activating a collection contract',
      );
    }
    if (expectedHash) {
      const code = await this.viewCode(rpcUrl, input.contractId);
      const actual = createHash('sha256').update(Buffer.from(code, 'base64')).digest('hex');
      if (actual !== expectedHash) {
        throw new BadRequestException('The contract code hash does not match KEIZ_COLLECT_CODE_HASH');
      }
    }
  }

  private async view<T>(
    rpcUrl: string,
    contractId: string,
    method: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetchRpcWithRetry(
      rpcUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'keiz-org-collection',
          method: 'query',
          params: {
            request_type: 'call',
            finality: 'final',
            account_id: contractId,
            method_name: method,
            args: Buffer.from(JSON.stringify(args)).toString('base64'),
          },
        }),
      },
      { timeoutMs: 15_000 },
    );
    const json = (await response.json()) as {
      result?: { result?: string };
      error?: { message?: string };
    };
    if (json.error || !json.result?.result) {
      throw new BadRequestException(
        `Collect contract validation failed (${method}): ${json.error?.message ?? 'no result'}`,
      );
    }
    return JSON.parse(Buffer.from(json.result.result, 'base64').toString('utf8')) as T;
  }

  private async viewCode(rpcUrl: string, contractId: string): Promise<string> {
    const response = await fetchRpcWithRetry(
      rpcUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'keiz-org-collection-code',
          method: 'query',
          params: { request_type: 'view_code', finality: 'final', account_id: contractId },
        }),
      },
      { timeoutMs: 15_000 },
    );
    const json = (await response.json()) as {
      result?: { code_base64?: string };
      error?: { message?: string };
    };
    if (json.error || !json.result?.code_base64) {
      throw new BadRequestException(
        `Could not read contract code: ${json.error?.message ?? 'no result'}`,
      );
    }
    return json.result.code_base64;
  }
}
