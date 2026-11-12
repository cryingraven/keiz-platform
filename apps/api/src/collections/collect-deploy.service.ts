import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Model } from 'mongoose';
import { KeyPair, connect, keyStores, transactions, utils } from 'near-api-js';
import { CollectionDeployInput, NEAR_ACCOUNT_RE } from '@keiz/shared';
import { NearNetwork, paymentsMode, walletNetwork } from '../common/network';
import { PaymentProviderFactory } from '../payments/payment-provider.factory';
import { QueueProducer } from '../queues/queue-producer.service';
import { Organization, OrganizationDocument } from '../users/organization.schema';
import { OrgCollectionService } from '../users/org-collection.service';
import {
  CollectionDeployment,
  CollectionDeploymentDocument,
  CollectionDeploymentStatus,
  CollectionDeployStep,
} from './collection-deployment.schema';

const INIT_GAS = BigInt('100000000000000'); // 100 Tgas
const CALL_GAS = BigInt('30000000000000'); // 30 Tgas
const STORAGE_NEAR = '0.02';
const BALANCE_RESERVE = BigInt('500000000000000000000000'); // 0.5 NEAR for gas
const STABLE_SYMBOLS = ['USDC', 'USDT'] as const;
const TERMINAL: CollectionDeploymentStatus[] = ['ACTIVE', 'FAILED'];

export interface DeployAsset {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  tokenContract: string;
}

export interface DeployCapabilities {
  enabled: boolean;
  reason?: string;
  network: NearNetwork;
  deployerAccount: string | null;
  codeHash: string | null;
  fundingNear: string;
  assets: DeployAsset[];
  latest: CollectionDeployment | null;
}

interface Wasm {
  code: Buffer;
  hash: string;
}

@Injectable()
export class CollectionDeployService {
  private readonly logger = new Logger(CollectionDeployService.name);
  private wasmCache?: Wasm;

  constructor(
    @InjectModel(CollectionDeployment.name)
    private readonly deployments: Model<CollectionDeploymentDocument>,
    @InjectModel(Organization.name)
    private readonly orgs: Model<OrganizationDocument>,
    private readonly collections: OrgCollectionService,
    private readonly providers: PaymentProviderFactory,
    private readonly queue: QueueProducer,
    private readonly config: ConfigService,
  ) {}

  private get enabledFlag(): boolean {
    return this.config.get<string>('COLLECT_DEPLOY_ENABLED') === 'true';
  }

  private get deployerAccount(): string {
    return (this.config.get<string>('COLLECT_DEPLOYER_ACCOUNT') || '').trim();
  }

  private get deployerSecret(): string {
    return (this.config.get<string>('COLLECT_DEPLOYER_PRIVATE_KEY') || '').trim();
  }

  private get network(): NearNetwork {
    return walletNetwork(this.config);
  }

  private fundingNear(): string {
    return this.config.get<string>('COLLECT_DEPLOY_FUNDING_NEAR') || '4';
  }

  private loadWasm(): Wasm {
    if (this.wasmCache) return this.wasmCache;
    const configured = this.config.get<string>('COLLECT_WASM_PATH');
    const file = configured
      ? path.isAbsolute(configured)
        ? configured
        : path.resolve(process.cwd(), configured)
      : [
          path.resolve(
            process.cwd(),
            '../../contracts/target/wasm32-unknown-unknown/release/keiz_collect.wasm',
          ),
          path.resolve(
            process.cwd(),
            '../contracts/target/wasm32-unknown-unknown/release/keiz_collect.wasm',
          ),
          path.resolve(
            process.cwd(),
            'contracts/target/wasm32-unknown-unknown/release/keiz_collect.wasm',
          ),
        ].find((candidate) => fs.existsSync(candidate)) ??
        path.resolve(
          process.cwd(),
          '../../contracts/target/wasm32-unknown-unknown/release/keiz_collect.wasm',
        );
    if (!fs.existsSync(file)) {
      throw new ServiceUnavailableException(
        'keiz-collect wasm is not available on this server; set COLLECT_WASM_PATH',
      );
    }
    const code = fs.readFileSync(file);
    const hash = createHash('sha256').update(code).digest('hex');
    const pinned = this.config.get<string>('KEIZ_COLLECT_CODE_HASH');
    if (pinned && pinned !== hash) {
      throw new ServiceUnavailableException(
        'COLLECT_WASM_PATH does not match KEIZ_COLLECT_CODE_HASH',
      );
    }
    this.wasmCache = { code, hash };
    return this.wasmCache;
  }

  private disabledReason(): string | null {
    if (!this.enabledFlag) return 'One-click contract deployment is disabled on this server.';
    if (this.network !== 'mainnet') {
      return 'One-click deployment is mainnet-only. Configure the collection contract manually.';
    }
    if (!this.deployerAccount) return 'COLLECT_DEPLOYER_ACCOUNT is not configured.';
    if (!NEAR_ACCOUNT_RE.test(this.deployerAccount)) {
      return 'COLLECT_DEPLOYER_ACCOUNT is not a valid NEAR account id.';
    }
    if (this.deployerAccount.endsWith('.testnet')) {
      return 'COLLECT_DEPLOYER_ACCOUNT must be a mainnet account.';
    }
    if (!this.deployerSecret) return 'COLLECT_DEPLOYER_PRIVATE_KEY is not configured.';
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(this.deployerSecret)) {
      return 'COLLECT_DEPLOYER_PRIVATE_KEY must be an ed25519 secret key.';
    }
    if (paymentsMode(this.config) !== 'intents') {
      return 'One-click deployment requires PAYMENTS_MODE=intents so token addresses come from 1Click.';
    }
    if (
      this.config.get<string>('NODE_ENV') === 'production' &&
      !this.config.get<string>('KEIZ_COLLECT_CODE_HASH')
    ) {
      return 'KEIZ_COLLECT_CODE_HASH is required before deploying a contract in production.';
    }
    try {
      this.loadWasm();
    } catch (error) {
      return (error as Error).message;
    }
    return null;
  }

  async capabilities(orgId: string): Promise<DeployCapabilities> {
    const org = await this.orgs.findById(orgId).lean();
    if (!org) throw new NotFoundException('Workspace not found');
    const network = org.network ?? this.network;
    const reason =
      network !== 'mainnet'
        ? 'One-click deployment is mainnet-only. Configure a testnet contract manually.'
        : this.disabledReason();
    let assets: DeployAsset[] = [];
    if (!reason) {
      try {
        assets = await this.listAssets();
      } catch (error) {
        this.logger.warn(`Could not load 1Click tokens: ${(error as Error).message}`);
      }
    }
    const assetReason =
      reason ?? (assets.length === 0 ? 'No supported USDC/USDT asset is available.' : null);
    const latest = await this.deployments
      .findOne({ orgId })
      .sort({ createdAt: -1 })
      .lean();
    return {
      enabled: !assetReason,
      reason: assetReason ?? undefined,
      network,
      deployerAccount: this.deployerAccount || null,
      codeHash: this.enabledFlag ? this.loadWasmQuietly()?.hash ?? null : null,
      fundingNear: this.fundingNear(),
      assets,
      latest: (latest as CollectionDeployment | null) ?? null,
    };
  }

  async get(orgId: string, id: string) {
    const deployment = await this.deployments.findOne({ _id: id, orgId }).lean();
    if (!deployment) throw new NotFoundException('Deployment not found');
    return deployment;
  }

  async request(
    orgId: string,
    userId: string,
    accountId: string,
    input: CollectionDeployInput,
  ): Promise<{ deploymentId: string; resumed: boolean }> {
    const reason = this.disabledReason();
    if (reason) throw new BadRequestException(reason);

    const org = await this.orgs.findById(orgId);
    if (!org) throw new NotFoundException('Workspace not found');
    if (org.collection?.status === 'ACTIVE') {
      throw new BadRequestException(
        'This workspace already has an active collection contract. Pause or disable it first.',
      );
    }

    const running = await this.deployments
      .findOne({ orgId, status: { $nin: TERMINAL } })
      .sort({ createdAt: -1 });
    if (running) return { deploymentId: running.id, resumed: true };

    const network = org.network ?? this.network;
    if (network !== 'mainnet') {
      throw new BadRequestException(
        'One-click deployment is mainnet-only. Configure a testnet contract manually.',
      );
    }
    const rpcUrl = this.collections.rpcFor(network);
    const assets = await this.listAssets();
    const asset = assets.find((item) => item.assetId === input.assetId);
    if (!asset) {
      throw new BadRequestException('Only the listed USDC/USDT assets can be collected');
    }
    if (!NEAR_ACCOUNT_RE.test(asset.tokenContract)) {
      throw new BadRequestException('The selected asset has an invalid NEP-141 contract');
    }

    const treasury = input.treasury ?? accountId;
    if (treasury !== accountId && !NEAR_ACCOUNT_RE.test(treasury)) {
      throw new BadRequestException('Invalid treasury account id');
    }
    const prefix = this.sanitizePrefix(input.prefix ?? org.slug);
    const contractId = await this.freeContractId(prefix, rpcUrl);

    let deployment: CollectionDeploymentDocument;
    try {
      deployment = await this.deployments.create({
        orgId,
        requestedByUserId: userId,
        ownerAccountId: accountId,
        status: 'QUEUED',
        network,
        contractId,
        treasury,
        assetId: asset.assetId,
        tokenContract: asset.tokenContract,
        decimals: asset.decimals,
        steps: this.emptySteps(),
        txHashes: [],
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const existing = await this.deployments
          .findOne({ orgId, status: { $nin: TERMINAL } })
          .sort({ createdAt: -1 });
        if (existing) return { deploymentId: existing.id, resumed: true };
      }
      throw error;
    }

    await this.enqueue(deployment.id).catch(async (error) => {
      await this.fail(deployment.id, `Could not queue the deployment: ${(error as Error).message}`);
      throw error;
    });
    return { deploymentId: deployment.id, resumed: false };
  }

  async retry(orgId: string, id: string): Promise<{ deploymentId: string }> {
    const deployment = await this.deployments.findOne({ _id: id, orgId });
    if (!deployment) throw new NotFoundException('Deployment not found');
    if (deployment.status !== 'FAILED') {
      throw new BadRequestException('Only a failed deployment can be retried');
    }
    await this.deployments.updateOne(
      { _id: deployment._id },
      {
        $set: { status: 'QUEUED', finishedAt: undefined },
        $unset: { error: '' },
      },
    );
    await this.enqueue(deployment.id).catch(async (error) => {
      await this.fail(deployment.id, `Could not queue the deployment: ${(error as Error).message}`);
      throw error;
    });
    return { deploymentId: deployment.id };
  }

  private async enqueue(deploymentId: string) {
    if (this.queue.enabled) {
      await this.queue.enqueueCollectionDeploy(deploymentId);
      return;
    }
    // No Redis in local tests/dev: run in the API process.
    void this.run(deploymentId).catch((error) => {
      this.logger.error(`Inline collection deploy failed: ${(error as Error).message}`);
    });
  }

  /** Idempotent: each step checks on-chain state before sending a transaction. */
  async run(id: string): Promise<void> {
    const deployment = await this.deployments.findById(id);
    if (!deployment || TERMINAL.includes(deployment.status)) return;

    const reason = this.disabledReason();
    if (reason) {
      await this.fail(id, reason);
      return;
    }

    try {
      const wasm = this.loadWasm();
      const rpcUrl = this.collections.rpcFor(deployment.network);
      const near = await connect({
        networkId: deployment.network,
        nodeUrl: rpcUrl,
        keyStore: await this.keyStore(deployment.network),
      });
      const deployer = await near.account(this.deployerAccount);

      await this.deployments.updateOne(
        { _id: deployment._id },
        { $set: { startedAt: new Date(), status: 'DEPLOYING' } },
      );

      // 1. Create the account, deploy the pinned wasm and initialize it.
      const existing = await this.collections.viewAccount(rpcUrl, deployment.contractId);
      if (existing) {
        const code = await this.collections.viewCode(rpcUrl, deployment.contractId);
        const deployedHash = createHash('sha256')
          .update(Buffer.from(code, 'base64'))
          .digest('hex');
        if (deployedHash !== wasm.hash) {
          throw new Error(
            `Account ${deployment.contractId} already exists with different contract code`,
          );
        }
        await this.step(id, 'account', 'DONE');
      } else {
        const funding = this.parseNear(this.fundingNear());
        const balance = await deployer.getAccountBalance();
        const available = BigInt(balance.available || balance.total || '0');
        if (available < funding + BALANCE_RESERVE) {
          throw new Error(
            `Deployer ${this.deployerAccount} is underfunded: needs ${utils.format.formatNearAmount(
              funding.toString(),
            )} NEAR plus gas`,
          );
        }
        await this.step(id, 'account', 'RUNNING');
        const result = await deployer.signAndSendTransaction({
          receiverId: deployment.contractId,
          actions: [
            transactions.createAccount(),
            transactions.transfer(funding),
            transactions.deployContract(wasm.code),
            transactions.functionCall(
              'new',
              {
                owner: this.deployerAccount,
                treasury: deployment.treasury,
                org_id: deployment.orgId,
              },
              INIT_GAS,
              BigInt(0),
            ),
          ],
        });
        await this.step(id, 'account', 'DONE', this.txHash(result));
      }

      // 2. Register the contract with the token and allowlist it. Both calls
      // are owner-only, so they must run before ownership moves to the user.
      const allowed = await this.collections.view<boolean>(
        rpcUrl,
        deployment.contractId,
        'is_token_allowed',
        { token: deployment.tokenContract },
      );
      if (!allowed) {
        await this.deployments.updateOne(
          { _id: deployment._id },
          { $set: { status: 'ALLOWLISTING' } },
        );
        await this.step(id, 'allowlist', 'RUNNING');
        const registration = await deployer.signAndSendTransaction({
          receiverId: deployment.tokenContract,
          actions: [
            transactions.functionCall(
              'storage_deposit',
              { account_id: deployment.contractId, registration_only: true },
              CALL_GAS,
              this.parseNear(STORAGE_NEAR),
            ),
          ],
        });
        const allowlist = await deployer.signAndSendTransaction({
          receiverId: deployment.contractId,
          actions: [
            transactions.functionCall(
              'set_allowed_token',
              { token: deployment.tokenContract, allowed: true },
              CALL_GAS,
              BigInt(0),
            ),
          ],
        });
        await this.step(id, 'allowlist', 'DONE', this.txHash(allowlist), [
          this.txHash(registration),
        ]);
      } else {
        await this.step(id, 'allowlist', 'DONE');
      }

      // 3. Hand the contract to the workspace user. No key is added to the
      // contract account, so nobody can sign from it after this point.
      const owner = await this.collections.view<string>(
        rpcUrl,
        deployment.contractId,
        'get_owner',
        {},
      );
      if (owner !== deployment.ownerAccountId) {
        if (owner !== this.deployerAccount) {
          throw new Error(
            `Contract owner is ${owner}; expected ${this.deployerAccount} before handover`,
          );
        }
        await this.deployments.updateOne(
          { _id: deployment._id },
          { $set: { status: 'TRANSFERRING' } },
        );
        await this.step(id, 'ownership', 'RUNNING');
        const result = await deployer.signAndSendTransaction({
          receiverId: deployment.contractId,
          actions: [
            transactions.functionCall(
              'set_owner',
              { owner: deployment.ownerAccountId },
              CALL_GAS,
              BigInt(0),
            ),
          ],
        });
        await this.step(id, 'ownership', 'DONE', this.txHash(result));
      } else {
        await this.step(id, 'ownership', 'DONE');
      }

      // 4. Verify through the same path the manual form uses, then activate.
      await this.deployments.updateOne(
        { _id: deployment._id },
        { $set: { status: 'VERIFYING' } },
      );
      await this.step(id, 'verify', 'RUNNING');
      await this.collections.update(deployment.orgId, {
        contractId: deployment.contractId,
        treasury: deployment.treasury,
        assetId: deployment.assetId,
        tokenContract: deployment.tokenContract,
        decimals: deployment.decimals,
        status: 'ACTIVE',
      });
      await this.step(id, 'verify', 'DONE');
      await this.deployments.updateOne(
        { _id: deployment._id },
        { $set: { status: 'ACTIVE', error: undefined, finishedAt: new Date() } },
      );
      this.logger.log(
        `Deployed collect contract ${deployment.contractId} for org ${deployment.orgId}`,
      );
    } catch (error) {
      await this.fail(id, (error as Error).message);
      throw error;
    }
  }

  private async listAssets(): Promise<DeployAsset[]> {
    const tokens = await this.providers.get().getTokens();
    const seen = new Set<string>();
    return tokens
      .filter(
        (token) =>
          token.blockchain.toLowerCase() === 'near' &&
          (STABLE_SYMBOLS as readonly string[]).includes(token.symbol.toUpperCase()) &&
          token.assetId.startsWith('nep141:'),
      )
      .filter((token) => {
        if (seen.has(token.assetId)) return false;
        seen.add(token.assetId);
        return true;
      })
      .map((token) => ({
        assetId: token.assetId,
        symbol: token.symbol.toUpperCase(),
        blockchain: token.blockchain,
        decimals: token.decimals,
        tokenContract: token.assetId.slice('nep141:'.length),
      }))
      .filter((token) => NEAR_ACCOUNT_RE.test(token.tokenContract))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  private async freeContractId(prefix: string, rpcUrl: string): Promise<string> {
    const deployer = this.deployerAccount;
    const maxPrefix = 64 - deployer.length - 1;
    if (maxPrefix < 2) {
      throw new BadRequestException('COLLECT_DEPLOYER_ACCOUNT is too long to create a subaccount');
    }
    const base = prefix.slice(0, maxPrefix).replace(/-+$/, '');
    if (base.length < 2) throw new BadRequestException('Invalid contract prefix');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const suffix = attempt === 0 ? '' : `-${randomBytes(2).toString('hex')}`;
      const head = `${base}${suffix}`.slice(0, maxPrefix).replace(/-+$/, '');
      const candidate = `${head}.${deployer}`;
      if (await this.collections.viewAccount(rpcUrl, candidate)) continue;
      return candidate;
    }
    throw new BadRequestException('Could not find an available contract account name');
  }

  private sanitizePrefix(value: string): string {
    const cleaned = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return (cleaned || 'keiz-collect').slice(0, 32);
  }

  private async keyStore(network: NearNetwork) {
    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(
      network,
      this.deployerAccount,
      KeyPair.fromString(this.deployerSecret as `ed25519:${string}`),
    );
    return keyStore;
  }

  private parseNear(value: string): bigint {
    const parsed = utils.format.parseNearAmount(value);
    if (!parsed) throw new Error(`Invalid NEAR amount: ${value}`);
    return BigInt(parsed);
  }

  private txHash(result: unknown): string {
    const value = result as {
      transaction_outcome?: { id?: string };
      transaction?: { hash?: string };
    };
    return value.transaction_outcome?.id ?? value.transaction?.hash ?? 'submitted';
  }

  private emptySteps(): Record<string, CollectionDeployStep> {
    return {
      account: { status: 'PENDING' },
      allowlist: { status: 'PENDING' },
      ownership: { status: 'PENDING' },
      verify: { status: 'PENDING' },
    };
  }

  private async step(
    id: string,
    key: string,
    status: CollectionDeployStep['status'],
    txHash?: string,
    extraHashes: string[] = [],
  ) {
    const set: Record<string, unknown> = {
      [`steps.${key}.status`]: status,
      [`steps.${key}.at`]: new Date(),
    };
    if (txHash) set[`steps.${key}.txHash`] = txHash;
    const update: Record<string, unknown> = { $set: set };
    const hashes = [txHash, ...extraHashes].filter(
      (hash): hash is string => Boolean(hash),
    );
    if (hashes.length > 0) update.$push = { txHashes: { $each: hashes } };
    await this.deployments.updateOne({ _id: id }, update);
  }

  private async fail(id: string, error: string) {
    this.logger.warn(`Collection deployment ${id} failed: ${error}`);
    await this.deployments.updateOne(
      { _id: id },
      { $set: { status: 'FAILED', error, finishedAt: new Date() } },
    );
  }

  private loadWasmQuietly(): Wasm | null {
    try {
      return this.loadWasm();
    } catch {
      return null;
    }
  }
}
