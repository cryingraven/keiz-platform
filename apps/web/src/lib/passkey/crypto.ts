'use client';

import { ed25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';
import { bytesToBase64, bytesToHex } from '../format';
import { NEP413_TAG, SEED_WRAP_INFO, SEED_WRAP_VERSION } from './constants';

export interface WrappedSeed {
  v: typeof SEED_WRAP_VERSION;
  nonce: string;
  ciphertext: string;
}

export interface DerivedNearKey {
  seed: Uint8Array;
  publicKey: Uint8Array;
  nearPublicKey: string;
  accountId: string;
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function deriveNearKey(seed: Uint8Array): DerivedNearKey {
  if (seed.length !== 32) throw new Error('The NEAR seed must be 32 bytes');
  const publicKey = ed25519.getPublicKey(seed);
  return {
    seed,
    publicKey,
    nearPublicKey: `ed25519:${bs58.encode(publicKey)}`,
    accountId: bytesToHex(publicKey),
  };
}

/** PRF output is credential-specific; bind the wrap key to the credential id. */
async function deriveWrapKey(prfOutput: Uint8Array, credentialId: string): Promise<CryptoKey> {
  if (prfOutput.length < 32) throw new Error('The authenticator returned a short PRF output');
  const raw = hkdf(
    sha256,
    prfOutput.subarray(0, 32),
    sha256(new TextEncoder().encode(`keiz:credential:${credentialId}`)),
    SEED_WRAP_INFO,
    32,
  );
  return crypto.subtle.importKey(
    'raw',
    raw as unknown as BufferSource,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}

function aad(accountId: string, credentialId: string): Uint8Array {
  return new TextEncoder().encode(`keiz:seed:${accountId}:${credentialId}`);
}

export async function wrapSeed(
  seed: Uint8Array,
  prfOutput: Uint8Array,
  accountId: string,
  credentialId: string,
): Promise<WrappedSeed> {
  const key = await deriveWrapKey(prfOutput, credentialId);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce as unknown as BufferSource,
        additionalData: aad(accountId, credentialId) as unknown as BufferSource,
      },
      key,
      seed as unknown as BufferSource,
    ),
  );
  return {
    v: SEED_WRAP_VERSION,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
  };
}

export async function unwrapSeed(
  wrapped: WrappedSeed,
  prfOutput: Uint8Array,
  accountId: string,
  credentialId: string,
): Promise<Uint8Array> {
  const key = await deriveWrapKey(prfOutput, credentialId);
  const nonce = base64ToBytes(wrapped.nonce);
  const ciphertext = base64ToBytes(wrapped.ciphertext);
  const seed = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as unknown as BufferSource,
        additionalData: aad(accountId, credentialId) as unknown as BufferSource,
      },
      key,
      ciphertext as unknown as BufferSource,
    ),
  );
  if (seed.length !== 32) throw new Error('The wrapped seed is invalid');
  return seed;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function borshText(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [...u32(bytes.length), ...bytes];
}

/** Exact NEP-413 Borsh serialization; mirrors packages/api/src/auth/nep413.ts. */
export function serializeNep413(params: {
  message: string;
  recipient: string;
  nonce: Uint8Array;
}): Uint8Array {
  if (params.nonce.length !== 32) throw new Error('NEP-413 nonce must be 32 bytes');
  return Uint8Array.from([
    ...u32(NEP413_TAG),
    ...borshText(params.message),
    ...params.nonce,
    ...borshText(params.recipient),
    0, // no callback URL
  ]);
}

export function signNep413(
  seed: Uint8Array,
  params: { message: string; recipient: string; nonce: Uint8Array },
): { signature: string; publicKey: string } {
  const key = deriveNearKey(seed);
  const hash = sha256(serializeNep413(params));
  const signature = ed25519.sign(hash, seed);
  return {
    signature: bytesToBase64(signature),
    publicKey: key.nearPublicKey,
  };
}

/** NEAR-compatible `ed25519:<base58>` secret key (seed || public key). */
export function encodeRecoveryKey(seed: Uint8Array): string {
  const key = deriveNearKey(seed);
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(key.publicKey, 32);
  return `ed25519:${bs58.encode(secret)}`;
}

export function decodeRecoveryKey(value: string): Uint8Array {
  const clean = value.trim().replace(/^ed25519:/, '');
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(clean);
  } catch {
    throw new Error('That is not a valid NEAR recovery key');
  }
  if (bytes.length === 32) return Uint8Array.from(bytes);
  if (bytes.length !== 64) throw new Error('A NEAR recovery key must be 32 or 64 bytes');
  const seed = Uint8Array.from(bytes.subarray(0, 32));
  const derived = ed25519.getPublicKey(seed);
  const embedded = bytes.subarray(32);
  if (derived.length !== embedded.length || derived.some((byte, index) => byte !== embedded[index])) {
    throw new Error('The recovery key does not match its public key');
  }
  return seed;
}

/** PRF output for the fixed application salt, from a WebAuthn extension result. */
export function prfOutputFromResults(results: unknown): Uint8Array | null {
  if (!results || typeof results !== 'object') return null;
  const prf = (results as { prf?: { results?: { first?: ArrayBuffer | Uint8Array } } }).prf;
  const first = prf?.results?.first;
  if (!first) return null;
  return first instanceof Uint8Array ? first : new Uint8Array(first);
}

export { base64UrlToBytes, bytesToBase64Url };
