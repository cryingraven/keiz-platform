import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

// Vitest transpiles without `design:type`, so keep Mongoose schemas out of the
// module graph; this spec only exercises orchestration.
vi.mock('./collection-deployment.schema', () => ({
  CollectionDeployment: class {},
  CollectionDeploymentSchema: {},
}));
vi.mock('../users/organization.schema', () => ({
  Organization: class {},
  OrganizationSchema: {},
}));

import { CollectionDeployService } from './collect-deploy.service';

function config(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

function mocks(overrides: Record<string, unknown> = {}) {
  const query = {
    lean: vi.fn().mockResolvedValue(null),
    then: (resolve: (value: null) => unknown) => resolve(null),
  };
  const deployments = {
    create: vi.fn().mockResolvedValue({ id: 'dep1' }),
    findOne: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue(query) }),
    ...(overrides.deployments as object),
  };
  const orgs = {
    findById: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'org1',
        slug: 'demo-near-415df8',
        network: 'mainnet',
        collection: undefined,
      }),
    }),
  };
  const collections = {
    rpcFor: vi.fn().mockReturnValue('https://rpc.mainnet.near.org'),
    viewAccount: vi.fn().mockResolvedValue(null),
  };
  const providers = {
    get: () => ({
      getTokens: vi.fn().mockResolvedValue([
        {
          assetId: 'nep141:usdc.near',
          symbol: 'USDC',
          blockchain: 'near',
          decimals: 6,
        },
      ]),
    }),
  };
  const queue = {
    enabled: true,
    enqueueCollectionDeploy: vi.fn().mockResolvedValue(undefined),
  };
  return { deployments, orgs, collections, providers, queue };
}

describe('CollectionDeployService', () => {
  it('reports the kill switch instead of deploying', async () => {
    const deps = mocks();
    const service = new CollectionDeployService(
      deps.deployments as never,
      deps.orgs as never,
      deps.collections as never,
      deps.providers as never,
      deps.queue as never,
      config({ COLLECT_DEPLOY_ENABLED: 'false', CHAIN_NETWORK: 'mainnet' }),
    );

    const caps = await service.capabilities('org1');
    expect(caps.enabled).toBe(false);
    expect(caps.assets).toEqual([]);
    expect(caps.reason).toContain('disabled');
  });

  it('resolves the contract account from the signed-in owner and queues one job', async () => {
    const deps = mocks();
    const service = new CollectionDeployService(
      deps.deployments as never,
      deps.orgs as never,
      deps.collections as never,
      deps.providers as never,
      deps.queue as never,
      config({
        COLLECT_DEPLOY_ENABLED: 'true',
        CHAIN_NETWORK: 'mainnet',
        NEXT_PUBLIC_CHAIN_NETWORK: 'mainnet',
        PAYMENTS_MODE: 'intents',
        COLLECT_DEPLOYER_ACCOUNT: 'deployer.near',
        COLLECT_DEPLOYER_PRIVATE_KEY: `ed25519:${'1'.repeat(86)}`,
      }),
    );

    const result = await service.request('org1', 'user1', 'alice.near', {
      assetId: 'nep141:usdc.near',
      prefix: 'demo-collect',
    });

    expect(result).toEqual({ deploymentId: 'dep1', resumed: false });
    expect(deps.deployments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org1',
        contractId: 'demo-collect.deployer.near',
        ownerAccountId: 'alice.near',
        treasury: 'alice.near',
        tokenContract: 'usdc.near',
        network: 'mainnet',
      }),
    );
    expect(deps.queue.enqueueCollectionDeploy).toHaveBeenCalledWith('dep1');
  });

  it('rejects an asset that is not in the supported list', async () => {
    const deps = mocks();
    const service = new CollectionDeployService(
      deps.deployments as never,
      deps.orgs as never,
      deps.collections as never,
      deps.providers as never,
      deps.queue as never,
      config({
        COLLECT_DEPLOY_ENABLED: 'true',
        CHAIN_NETWORK: 'mainnet',
        NEXT_PUBLIC_CHAIN_NETWORK: 'mainnet',
        PAYMENTS_MODE: 'intents',
        COLLECT_DEPLOYER_ACCOUNT: 'deployer.near',
        COLLECT_DEPLOYER_PRIVATE_KEY: `ed25519:${'1'.repeat(86)}`,
      }),
    );

    await expect(
      service.request('org1', 'user1', 'alice.near', {
        assetId: 'nep141:usdc.eth',
      }),
    ).rejects.toThrow('Only the listed USDC/USDT assets');
  });
});
