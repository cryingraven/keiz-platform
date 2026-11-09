import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchRpcWithRetry } from '../common/rpc-client';
import { decodePublicKey, verifyNep413 } from './nep413';

/** Transport/JSON failure talking to NEAR RPC (not an invalid signature). */
export class NearRpcError extends Error {
  constructor(message = 'NEAR RPC is unavailable') {
    super(message);
    this.name = 'NearRpcError';
  }
}

export interface NearSignatureInput {
  message: string;
  recipient: string;
  nonce: Buffer;
  signature: string;
  publicKey: string;
}

@Injectable()
export class NearVerifyService {
  private readonly logger = new Logger(NearVerifyService.name);

  constructor(private readonly config: ConfigService) {}

  private rpcUrl(network: 'mainnet' | 'testnet'): string {
    if (network === 'testnet') {
      return this.config.get<string>('NEAR_AUTH_RPC_URL') || 'https://rpc.testnet.near.org';
    }
    return this.config.get<string>('NEAR_RPC_URL') || 'https://free.rpc.fastnear.com';
  }

  private async rpc(
    url: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ result?: unknown; error?: { cause?: { name?: string }; message?: string } }> {
    try {
      const response = await fetchRpcWithRetry(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'keiz-auth', method, params }),
        },
        { timeoutMs: 15_000 },
      );
      return (await response.json()) as {
        result?: unknown;
        error?: { cause?: { name?: string }; message?: string };
      };
    } catch (error) {
      this.logger.warn(`NEAR RPC request failed (${method}): ${(error as Error).message}`);
      throw new NearRpcError();
    }
  }

  async verify(input: NearSignatureInput): Promise<void> {
    let valid = false;
    try {
      valid = verifyNep413(
        {
          message: input.message,
          recipient: input.recipient,
          nonce: input.nonce,
        },
        input.publicKey,
        input.signature,
      );
    } catch (error) {
      this.logger.warn(`Malformed NEP-413 payload: ${(error as Error).message}`);
      throw new Error('Malformed signature payload');
    }
    if (!valid) throw new Error('Signature does not match the message and key');
  }

  /**
   * NEP-413 must be signed with a full-access key. A function-call key can sign
   * arbitrary bytes, so checking the on-chain permission is part of auth, not a nicety.
   */
  async assertFullAccessKey(
    accountId: string,
    publicKey: string,
    network: 'mainnet' | 'testnet' = 'mainnet',
  ): Promise<void> {
    const url = this.rpcUrl(network);

    // NEAR Auth users often start with an implicit account that does not exist
    // on-chain yet. Accept that only when the account id is exactly the hex of
    // the public key and the chain explicitly reports UNKNOWN_ACCOUNT.
    const account = await this.rpc(url, 'query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    });
    if (account.error) {
      const unknown =
        account.error.cause?.name === 'UNKNOWN_ACCOUNT' ||
        /does not exist/i.test(account.error.message ?? '');
      if (unknown) {
        const expected = decodePublicKey(publicKey).toString('hex').toLowerCase();
        if (accountId.toLowerCase() === expected) return;
        throw new Error('This NEAR account does not exist on-chain');
      }
      throw new Error('Could not read the account from NEAR');
    }

    const key = await this.rpc(url, 'query', {
      request_type: 'view_access_key',
      finality: 'final',
      account_id: accountId,
      public_key: publicKey,
    });
    const result = key.result as { permission?: unknown } | undefined;
    if (key.error || !result) {
      throw new Error('Public key is not an access key on this account');
    }
    const permission = result.permission;
    const isFullAccess = permission === 'FullAccess' || permission === 'full_access';
    if (!isFullAccess) {
      throw new Error('Sign in with a full-access key (function-call keys cannot authenticate)');
    }
  }
}
