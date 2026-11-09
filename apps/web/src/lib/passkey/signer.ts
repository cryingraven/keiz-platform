'use client';

import { connect, KeyPair, keyStores, transactions, utils } from 'near-api-js';
import type { NearNetwork } from '../network';
import { encodeRecoveryKey } from './crypto';

export interface PasskeyTransaction {
  receiverId: string;
  actions: Array<{
    type: string;
    params: Record<string, unknown>;
  }>;
}

interface SignerConfig {
  accountId: string;
  seed: Uint8Array;
  network: NearNetwork;
  rpcUrl?: string;
}

/**
 * A minimal wallet adapter for a passkey-derived NEAR key. It accepts the same
 * `{ receiverId, actions }` shape the existing pay panel sends through
 * near-connect, so on-chain flows do not need a second code path.
 */
export class PasskeySigner {
  private readonly keyPair: KeyPair;
  private readonly keyStore = new keyStores.InMemoryKeyStore();
  private readonly rpcUrl: string;

  constructor(private readonly config: SignerConfig) {
    this.keyPair = KeyPair.fromString(encodeRecoveryKey(config.seed) as never);
    this.rpcUrl =
      config.rpcUrl ||
      (config.network === 'mainnet'
        ? 'https://free.rpc.fastnear.com'
        : 'https://rpc.testnet.near.org');
  }

  async signAndSendTransactions(input: { transactions: PasskeyTransaction[] }) {
    const near = await connect({
      networkId: this.config.network,
      nodeUrl: this.rpcUrl,
      keyStore: this.keyStore,
    });
    await this.keyStore.setKey(this.config.network, this.config.accountId, this.keyPair);
    const account = await near.account(this.config.accountId);

    const results: Array<{ transaction: { hash: string } }> = [];
    for (const item of input.transactions) {
      const result = await account.signAndSendTransaction({
        receiverId: item.receiverId,
        actions: item.actions.map((action) => toNearAction(action)),
      });
      results.push({
        transaction: {
          hash: result.transaction_outcome?.id ?? result.transaction?.hash ?? '',
        },
      });
    }
    return results;
  }
}

function toNearAction(action: PasskeyTransaction['actions'][number]) {
  const params = action.params ?? {};
  switch (action.type) {
    case 'FunctionCall':
      return transactions.functionCall(
        String(params.methodName),
        (params.args ?? {}) as object,
        BigInt(String(params.gas ?? '30000000000000')),
        BigInt(String(params.deposit ?? '0')),
      );
    case 'Transfer':
      return transactions.transfer(BigInt(String(params.deposit ?? params.amount ?? '0')));
    case 'AddKey': {
      const publicKey = utils.PublicKey.fromString(String(params.publicKey));
      const accessKey = (params.accessKey ?? {}) as {
        nonce?: number | string;
        permission?: string | { receiver_id: string; method_names: string[]; allowance?: string };
      };
      const functionCall =
        typeof accessKey.permission === 'object'
          ? (accessKey.permission as {
              receiverId?: string;
              receiver_id?: string;
              methodNames?: string[];
              method_names?: string[];
              allowance?: string;
            })
          : null;
      const receiverId = functionCall?.receiverId ?? functionCall?.receiver_id;
      const methodNames = functionCall?.methodNames ?? functionCall?.method_names;
      const access =
        accessKey.permission === 'FullAccess' ||
        accessKey.permission === undefined ||
        !functionCall ||
        !receiverId ||
        !methodNames
          ? transactions.fullAccessKey()
          : transactions.functionCallAccessKey(
              receiverId,
              methodNames,
              functionCall.allowance ? BigInt(functionCall.allowance) : undefined,
            );
      return transactions.addKey(publicKey, access);
    }
    case 'DeleteKey':
      return transactions.deleteKey(utils.PublicKey.fromString(String(params.publicKey)));
    default:
      throw new Error(`Unsupported passkey transaction action: ${action.type}`);
  }
}
