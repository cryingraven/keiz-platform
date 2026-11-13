import {
  formatUnits,
  isPositiveDecimal,
  parseNearAccountId,
  parseUnits,
  type WalletOverview,
} from '@keiz/shared';
import { formatToken } from './format';
import { chainNetwork, type NearNetwork } from './network';
import type { PasskeyTransaction } from './passkey/signer';

/** Keep enough NEAR on hand for storage, gas and account rent. */
export const NEAR_TRANSFER_RESERVE = parseUnits('0.05', 24);
/** Fallback when the token contract cannot report `storage_balance_bounds.min`. */
export const DEFAULT_FT_STORAGE_DEPOSIT = parseUnits('0.00125', 24);
const FT_TRANSFER_GAS = '30000000000000';
const FT_STORAGE_GAS = '30000000000000';
const INTENTS_WITHDRAW_GAS = '100000000000000';
export const INTENTS_CONTRACT_ID = 'intents.near';

export type WalletAsset =
  | {
      key: 'near';
      kind: 'near';
      symbol: string;
      name: string;
      decimals: number;
      balance: string;
    }
  | {
      key: string;
      kind: 'token';
      contractId: string;
      symbol: string;
      name: string;
      decimals: number;
      balance: string;
    }
  | {
      key: string;
      kind: 'intents';
      tokenId: string;
      tokenContract: string;
      symbol: string;
      name: string;
      decimals: number;
      balance: string;
    };

export function buildWalletAssets(overview: WalletOverview): WalletAsset[] {
  const assets: WalletAsset[] = [
    {
      key: 'near',
      kind: 'near',
      symbol: 'NEAR',
      name: 'NEAR',
      decimals: 24,
      balance: overview.near.available,
    },
    ...overview.tokens.map((token) => ({
      key: token.contractId,
      kind: 'token' as const,
      contractId: token.contractId,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      balance: token.balance,
    })),
  ];
  if (overview.intents) {
    assets.push({
      key: 'intents-usdc',
      kind: 'intents',
      tokenId: overview.intents.tokenId,
      tokenContract: overview.intents.tokenContract,
      symbol: overview.intents.symbol,
      name: 'NEAR Intents',
      decimals: overview.intents.decimals,
      balance: overview.intents.balance,
    });
  }
  return assets;
}

export function formatAssetAmount(balance: string, decimals: number): string {
  try {
    const text = formatUnits(balance, decimals);
    const value = Number(text);
    if (value > 0 && value < 0.000001) return '<0.000001';
    return formatToken(text);
  } catch {
    return '0';
  }
}

/** Minor units available to send, after the native reserve. */
export function maxSendable(asset: WalletAsset): bigint {
  const balance = safeBigInt(asset.balance);
  if (asset.kind === 'near') {
    const usable = balance - NEAR_TRANSFER_RESERVE;
    return usable > 0n ? usable : 0n;
  }
  return balance;
}

export interface TransferInput {
  asset: WalletAsset;
  recipient: string;
  /** Major units as typed by the user, e.g. "1.5". */
  amount: string;
  /** Include storage_deposit before ft_transfer for an unregistered recipient. */
  registerStorage?: boolean;
  storageDeposit?: string;
  /** On-chain NEAR available to pay an optional storage deposit. */
  nativeBalance?: string;
}

export function validateTransfer(input: TransferInput): string | null {
  const recipient = input.recipient.trim();
  if (!recipient) return 'Enter a recipient account';
  if (!parseNearAccountId(recipient)) return 'Enter a valid NEAR account id';

  const raw = input.amount.trim();
  if (!raw) return 'Enter an amount';
  if (!isPositiveDecimal(raw)) return 'Enter a positive amount';

  let amount: bigint;
  try {
    amount = parseUnits(raw, input.asset.decimals);
  } catch {
    return `Use at most ${input.asset.decimals} decimal places`;
  }
  if (amount <= 0n) return 'Enter an amount greater than zero';

  if (input.asset.kind === 'near') {
    const balance = safeBigInt(input.asset.balance);
    if (amount + NEAR_TRANSFER_RESERVE > balance) {
      return `Leave at least ${formatUnits(NEAR_TRANSFER_RESERVE, 24)} NEAR for gas and storage`;
    }
    return null;
  }

  if (amount > safeBigInt(input.asset.balance)) {
    return `You only have ${formatAssetAmount(input.asset.balance, input.asset.decimals)} ${input.asset.symbol}`;
  }

  if (input.asset.kind === 'intents' && input.registerStorage) {
    const deposit = BigInt(input.storageDeposit ?? DEFAULT_FT_STORAGE_DEPOSIT.toString());
    const needed = deposit + NEAR_TRANSFER_RESERVE;
    if (safeBigInt(input.nativeBalance ?? '0') < needed) {
      return `Not enough NEAR to register the recipient. Leave ${formatUnits(needed, 24)} NEAR available.`;
    }
  }
  return null;
}

/**
 * Builds the exact transaction payload sent through `useAuth().sendTransactions`.
 * The API never signs and never sees these actions.
 */
export function buildTransferTransactions(input: TransferInput): PasskeyTransaction[] {
  const error = validateTransfer(input);
  if (error) throw new Error(error);

  const recipient = input.recipient.trim();
  const amount = parseUnits(input.amount.trim(), input.asset.decimals).toString();

  if (input.asset.kind === 'near') {
    return [
      {
        receiverId: recipient,
        actions: [{ type: 'Transfer', params: { deposit: amount } }],
      },
    ];
  }

  if (input.asset.kind === 'intents') {
    const transactions: PasskeyTransaction[] = [];
    if (input.registerStorage) {
      transactions.push({
        receiverId: input.asset.tokenContract,
        actions: [
          {
            type: 'FunctionCall',
            params: {
              methodName: 'storage_deposit',
              args: { account_id: recipient },
              gas: FT_STORAGE_GAS,
              deposit:
                input.storageDeposit && /^\d+$/.test(input.storageDeposit)
                  ? input.storageDeposit
                  : DEFAULT_FT_STORAGE_DEPOSIT.toString(),
            },
          },
        ],
      });
    }
    transactions.push({
      receiverId: INTENTS_CONTRACT_ID,
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'ft_withdraw',
            // Direct withdrawals take the unprefixed NEP-141 contract id.
            args: {
              token: input.asset.tokenContract,
              receiver_id: recipient,
              amount,
            },
            gas: INTENTS_WITHDRAW_GAS,
            deposit: '1',
          },
        },
      ],
    });
    return transactions;
  }

  const actions: PasskeyTransaction['actions'] = [];
  if (input.registerStorage) {
    actions.push({
      type: 'FunctionCall',
      params: {
        methodName: 'storage_deposit',
        args: { account_id: recipient },
        gas: FT_STORAGE_GAS,
        deposit:
          input.storageDeposit && /^\d+$/.test(input.storageDeposit)
            ? input.storageDeposit
            : DEFAULT_FT_STORAGE_DEPOSIT.toString(),
      },
    });
  }
  actions.push({
    type: 'FunctionCall',
    params: {
      methodName: 'ft_transfer',
      args: { receiver_id: recipient, amount },
      gas: FT_TRANSFER_GAS,
      deposit: '1',
    },
  });

  return [{ receiverId: input.asset.contractId, actions }];
}

export function explorerTxUrl(hash: string, network: NearNetwork = chainNetwork): string | null {
  if (!/^[A-Za-z0-9]{6,100}$/.test(hash)) return null;
  const host = network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
  return `${host}/txns/${encodeURIComponent(hash)}`;
}

export function explorerAccountUrl(
  accountId: string,
  network: NearNetwork = chainNetwork,
): string {
  const host = network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
  return `${host}/address/${encodeURIComponent(accountId)}`;
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
