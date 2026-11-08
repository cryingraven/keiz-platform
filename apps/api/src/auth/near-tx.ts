import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

/**
 * Minimal NEAR transaction builder used only by the passkey relayer.
 * We deliberately do not add near-api-js (ESM) to the CommonJS API.
 */

export interface SignActionInput {
  receiverId: string;
  methodName: string;
  argsBase64: string;
  gas: string;
  deposit: string;
}

export interface RelayResult {
  successValue: string;
  txHash: string;
}

export class NearRelayError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
  }
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value, 0);
  return buffer;
}

function u128(value: bigint): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.writeBigUInt64LE(value & 0xffffffffffffffffn, 0);
  buffer.writeBigUInt64LE(value >> 64n, 8);
  return buffer;
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u32(bytes.length), bytes]);
}

function borshBytes(value: Buffer): Buffer {
  return Buffer.concat([u32(value.length), value]);
}

function keyType(): Buffer {
  return Buffer.from([0]); // ed25519
}

export function validateSignAction(
  input: SignActionInput,
  config: { contractId: string; maxGas: bigint },
): Buffer {
  if (input.receiverId !== config.contractId) {
    throw new NearRelayError('Relayer only calls the configured NEAR Auth contract', 400);
  }
  if (input.methodName !== 'sign') {
    throw new NearRelayError('Relayer only forwards sign calls', 400);
  }

  let gas: bigint;
  let deposit: bigint;
  try {
    gas = BigInt(input.gas);
    deposit = BigInt(input.deposit);
  } catch {
    throw new NearRelayError('gas and deposit must be integers', 400);
  }
  if (gas <= 0n || gas > config.maxGas) {
    throw new NearRelayError('Gas is outside the allowed range', 400);
  }
  if (deposit !== 0n) {
    throw new NearRelayError('The relayer does not attach a deposit', 400);
  }

  let args: Buffer;
  try {
    args = Buffer.from(input.argsBase64, 'base64');
  } catch {
    throw new NearRelayError('argsBase64 is not valid base64', 400);
  }
  if (args.length === 0 || args.length > 16_384) {
    throw new NearRelayError('Action arguments are empty or too large', 400);
  }

  return serializeFunctionCall(input.methodName, args, gas, deposit);
}

function serializeFunctionCall(
  methodName: string,
  args: Buffer,
  gas: bigint,
  deposit: bigint,
): Buffer {
  return Buffer.concat([
    Buffer.from([2]), // Action::FunctionCall
    borshString(methodName),
    borshBytes(args),
    u64(gas),
    u128(deposit),
  ]);
}

export function buildTransaction(params: {
  signerId: string;
  publicKey: Buffer;
  nonce: bigint;
  receiverId: string;
  blockHash: Buffer;
  actions: Buffer[];
}): Buffer {
  if (params.blockHash.length !== 32) throw new NearRelayError('Invalid block hash', 500);
  if (params.publicKey.length !== 32) throw new NearRelayError('Invalid public key', 500);
  return Buffer.concat([
    borshString(params.signerId),
    keyType(),
    params.publicKey,
    u64(params.nonce),
    borshString(params.receiverId),
    params.blockHash,
    u32(params.actions.length),
    ...params.actions,
  ]);
}

export function signTransaction(transaction: Buffer, secretKey: Uint8Array): Buffer {
  const hash = createHash('sha256').update(transaction).digest();
  const signature = nacl.sign.detached(hash, secretKey);
  return Buffer.concat([transaction, keyType(), Buffer.from(signature)]);
}

export function parseRelayerKey(raw: string): nacl.SignKeyPair {
  const clean = raw.replace(/^ed25519:/, '').trim();
  const bytes = Buffer.from(bs58.decode(clean));
  if (bytes.length === 64) return nacl.sign.keyPair.fromSecretKey(bytes);
  if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes);
  throw new NearRelayError('Relayer private key must be 32 or 64 bytes', 500);
}

export function extractSuccessValue(result: {
  status?: { SuccessValue?: string; Failure?: unknown };
  transaction_outcome?: { id?: string };
}): RelayResult {
  const status = result.status;
  if (status?.SuccessValue !== undefined) {
    if (!status.SuccessValue) {
      throw new NearRelayError('NEAR Auth did not sign the message', 502);
    }
    return {
      successValue: status.SuccessValue,
      txHash: result.transaction_outcome?.id ?? '',
    };
  }
  throw new NearRelayError('NEAR Auth sign call failed', 502);
}

export interface RelayerConfig {
  rpcUrl: string;
  contractId: string;
  accountId?: string;
  privateKey?: string;
  maxGas: bigint;
}

export class NearAuthRelayer {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: RelayerConfig) {}

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.config.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'keiz-passkey', method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json()) as { result?: T; error?: { message?: string } };
    if (json.error || json.result === undefined) {
      throw new NearRelayError(json.error?.message ?? 'NEAR RPC request failed', 502);
    }
    return json.result;
  }

  async relay(input: SignActionInput): Promise<RelayResult> {
    const action = validateSignAction(input, {
      contractId: this.config.contractId,
      maxGas: this.config.maxGas,
    });

    if (!this.config.accountId || !this.config.privateKey) {
      throw new NearRelayError(
        'Passkey relayer is not configured. Set NEAR_AUTH_RELAYER_ACCOUNT_ID and NEAR_AUTH_RELAYER_PRIVATE_KEY.',
        503,
      );
    }

    return this.serialize(async () => {
      const keyPair = parseRelayerKey(this.config.privateKey!);
      const publicKey = `ed25519:${bs58.encode(Buffer.from(keyPair.publicKey))}`;

      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const accessKey = await this.rpc<{ nonce: number }>('query', {
            request_type: 'view_access_key',
            finality: 'final',
            account_id: this.config.accountId,
            public_key: publicKey,
          });

          const block = await this.rpc<{ header: { hash: string } }>('block', {
            finality: 'final',
          });

          const transaction = buildTransaction({
            signerId: this.config.accountId!,
            publicKey: Buffer.from(keyPair.publicKey),
            // A tiny per-attempt offset avoids colliding with another instance
            // that read the same access-key nonce. Retries re-read the nonce.
            nonce: BigInt(accessKey.nonce) + 1n + BigInt(attempt),
            receiverId: input.receiverId,
            blockHash: Buffer.from(bs58.decode(block.header.hash)),
            actions: [action],
          });

          const signed = signTransaction(transaction, keyPair.secretKey);
          const outcome = await this.rpc<{
            status?: { SuccessValue?: string; Failure?: unknown };
            transaction_outcome?: { id?: string };
          }>('send_tx', {
            signed_tx_base64: signed.toString('base64'),
            wait_until: 'FINAL',
          });

          return extractSuccessValue(outcome);
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : '';
          const retryable = /nonce|expired|too far|invalid transaction/i.test(message);
          if (!retryable || attempt === 2) break;
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new NearRelayError('Relayer transaction failed', 502);
    });
  }
}
