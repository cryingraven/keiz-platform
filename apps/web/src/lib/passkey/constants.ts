import { sha256 } from '@noble/hashes/sha256';

/** Fixed PRF salt. Changing it changes every user's derived NEAR key. */
export const PRF_SALT = sha256(new TextEncoder().encode('keiz:passkey:prf:v1'));

export const SEED_WRAP_INFO = new TextEncoder().encode('keiz:passkey:seed-wrap:v1');
export const SEED_WRAP_VERSION = 1 as const;

/** Borsh tag for NEP-413 signed messages. */
export const NEP413_TAG = 2 ** 31 + 413;
