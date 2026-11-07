/**
 * Single frontend network switch.
 *
 * `NEXT_PUBLIC_CHAIN_NETWORK` (mainnet | testnet) drives wallet login, the
 * passkey defaults and the dashboard badge. `NEXT_PUBLIC_NEAR_NETWORK` is kept
 * as a legacy fallback so existing deployments keep working.
 */
export type NearNetwork = 'mainnet' | 'testnet';

const raw =
  process.env.NEXT_PUBLIC_CHAIN_NETWORK ?? process.env.NEXT_PUBLIC_NEAR_NETWORK;

export const chainNetwork: NearNetwork = raw === 'mainnet' ? 'mainnet' : 'testnet';

export const isMainnet = chainNetwork === 'mainnet';

export const networkLabel = isMainnet ? 'Mainnet' : 'Testnet';
