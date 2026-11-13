import { z } from 'zod';
import { nearAccountId } from './schemas';

/**
 * Wallet overview for the signed-in user's own NEAR account.
 *
 * All monetary values are integer strings in the asset's smallest unit.
 * `decimals` is sent alongside each value so the client formats it with
 * `formatUnits` instead of doing float math.
 */
export interface WalletNearBalance {
  /** Total yoctoNEAR (available + staked). */
  total: string;
  /** Unstaked yoctoNEAR available to transfer. */
  available: string;
  /** Staked yoctoNEAR. */
  staked: string;
  /** Account storage usage in bytes. */
  storageBytes: number;
}

export interface WalletTokenBalance {
  /** NEP-141 contract account id. This is a contract id, never a 1Click asset id. */
  contractId: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Integer string in the token's smallest unit. */
  balance: string;
}

export interface WalletOverview {
  accountId: string;
  network: 'mainnet' | 'testnet';
  /** False when the account has not been created on-chain (implicit passkey accounts). */
  exists: boolean;
  near: WalletNearBalance;
  tokens: WalletTokenBalance[];
  /**
   * True when only the curated token list could be read (the index was down or
   * the network has no index). Balances are still correct for listed tokens.
   */
  partial: boolean;
  fetchedAt: string;
}

export interface WalletRecipient {
  accountId: string;
  exists: boolean;
  contractId: string | null;
  /** Null when no contract was asked for or the contract is not NEP-141. */
  registered: boolean | null;
  /** Minimum storage deposit in yoctoNEAR when `registered` is false. */
  requiredStorageDeposit: string | null;
}

export const walletRecipientQuerySchema = z.object({
  contractId: nearAccountId.optional(),
});

export type WalletRecipientQuery = z.infer<typeof walletRecipientQuerySchema>;

/** Normalises and validates an account id coming from the client. */
export function parseNearAccountId(value: string): string | null {
  const parsed = nearAccountId.safeParse(value.trim());
  return parsed.success ? parsed.data : null;
}
