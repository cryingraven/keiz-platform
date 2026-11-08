import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchRpcWithRetry } from '../common/rpc-client';

export interface DepositClaim {
  txHash: string;
  senderAccountId: string;
  depositAddress: string;
  originAsset: string;
  minAmount: string;
}

export interface RpcTransactionResult {
  final_execution_status?: string;
  transaction?: {
    signer_id?: string;
    receiver_id?: string;
    actions?: Array<Record<string, unknown>>;
  };
  transaction_outcome?: { outcome?: { status?: unknown } };
}

export interface VerificationResult {
  ok: boolean;
  reason?: string;
}

function successStatus(status: unknown): boolean {
  if (!status || typeof status !== 'object') return false;
  const record = status as Record<string, unknown>;
  return 'SuccessValue' in record || 'SuccessReceiptId' in record;
}

function decodeArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Pure verification of a NEAR deposit transaction for a 1Click quote.
 * The tx must call ft_transfer/ft_transfer_call on the origin token contract,
 * targeting the quote deposit address, for at least the quoted amount.
 */
export function verifyDepositTransaction(
  result: RpcTransactionResult | null,
  claim: DepositClaim,
): VerificationResult {
  if (!result || !result.transaction) return { ok: false, reason: 'Transaction not found' };

  const status = result.transaction_outcome?.outcome?.status;
  if (!successStatus(status)) return { ok: false, reason: 'Transaction did not succeed' };

  const finality = result.final_execution_status;
  if (finality && !['FINAL', 'EXECUTED_OPTIMISTIC'].includes(finality)) {
    return { ok: false, reason: `Transaction is not final (${finality})` };
  }

  if (!claim.originAsset.startsWith('nep141:')) {
    return { ok: false, reason: 'Origin asset is not a NEP-141 token' };
  }
  const tokenContract = claim.originAsset.slice('nep141:'.length);

  // Fail closed: the transaction must be signed by the claimed payer and must
  // call the quoted token contract. Never accept a bare FunctionCall shape.
  if (!result.transaction.signer_id) {
    return { ok: false, reason: 'Transaction signer is missing' };
  }
  if (result.transaction.signer_id !== claim.senderAccountId) {
    return { ok: false, reason: 'Transaction was not signed by the claimed payer' };
  }
  if (result.transaction.receiver_id !== tokenContract) {
    return { ok: false, reason: 'Transaction did not call the origin token contract' };
  }

  const actions = result.transaction.actions ?? [];
  for (const action of actions) {
    const call = action.FunctionCall as
      | { method_name?: string; args?: unknown }
      | undefined;
    if (!call) continue;
    if (!['ft_transfer', 'ft_transfer_call'].includes(call.method_name ?? '')) continue;

    const args = decodeArgs(call.args);
    if (args.receiver_id !== claim.depositAddress) continue;

    const amount = typeof args.amount === 'string' ? args.amount : '0';
    try {
      if (BigInt(amount) < BigInt(claim.minAmount)) {
        return {
          ok: false,
          reason: `Deposit amount ${amount} is below the quoted ${claim.minAmount}`,
        };
      }
    } catch {
      return { ok: false, reason: 'Deposit amount is not an integer' };
    }

    return { ok: true };
  }

  return {
    ok: false,
    reason: 'No ft_transfer to the deposit address was found in the transaction',
  };
}

@Injectable()
export class NearTxVerifier {
  private readonly logger = new Logger(NearTxVerifier.name);

  constructor(private readonly config: ConfigService) {}

  private get rpcUrl(): string {
    return this.config.get<string>('NEAR_RPC_URL') || 'https://free.rpc.fastnear.com';
  }

  async verify(claim: DepositClaim): Promise<VerificationResult> {
    const response = await fetchRpcWithRetry(
      this.rpcUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'keiz-deposit-verify',
          method: 'tx',
          params: {
            tx_hash: claim.txHash,
            sender_account_id: claim.senderAccountId,
            wait_until: 'FINAL',
          },
        }),
      },
      { timeoutMs: 20_000 },
    );

    const json = (await response.json()) as {
      result?: RpcTransactionResult;
      error?: { message?: string; cause?: { name?: string } };
    };
    if (json.error) {
      this.logger.warn(`Deposit verification failed: ${json.error.message ?? 'unknown'}`);
      return { ok: false, reason: 'Transaction could not be verified on NEAR' };
    }
    return verifyDepositTransaction(json.result ?? null, claim);
  }
}
