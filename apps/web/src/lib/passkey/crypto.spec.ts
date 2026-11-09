import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import {
  decodeRecoveryKey,
  deriveNearKey,
  encodeRecoveryKey,
  serializeNep413,
  signNep413,
  unwrapSeed,
  wrapSeed,
} from './crypto';

const seed = new Uint8Array(32).fill(7);
const prf = new Uint8Array(32).fill(9);
const accountId = deriveNearKey(seed).accountId;
const credentialId = 'test-credential-id';

describe('passkey seed wrapping', () => {
  it('round-trips a seed with the same PRF output and credential', async () => {
    const wrapped = await wrapSeed(seed, prf, accountId, credentialId);
    const unwrapped = await unwrapSeed(wrapped, prf, accountId, credentialId);
    expect(Array.from(unwrapped)).toEqual(Array.from(seed));
  });

  it('rejects a different PRF output', async () => {
    const wrapped = await wrapSeed(seed, prf, accountId, credentialId);
    const wrong = new Uint8Array(32).fill(8);
    await expect(unwrapSeed(wrapped, wrong, accountId, credentialId)).rejects.toBeTruthy();
  });

  it('rejects a different account binding', async () => {
    const wrapped = await wrapSeed(seed, prf, accountId, credentialId);
    await expect(unwrapSeed(wrapped, prf, 'b'.repeat(64), credentialId)).rejects.toBeTruthy();
  });
});

describe('NEAR key derivation', () => {
  it('derives a 64-char implicit account and self-custodial recovery key', () => {
    const key = deriveNearKey(seed);
    expect(key.accountId).toMatch(/^[0-9a-f]{64}$/);
    expect(key.accountId).toBe(key.accountId.toLowerCase());
    const encoded = encodeRecoveryKey(seed);
    expect(encoded.startsWith('ed25519:')).toBe(true);
    expect(Array.from(decodeRecoveryKey(encoded))).toEqual(Array.from(seed));
  });

  it('produces a verifiable NEP-413 signature', () => {
    const nonce = new Uint8Array(32).fill(3);
    const message = 'localhost wants you to sign in';
    const signed = signNep413(seed, { message, recipient: 'localhost', nonce });
    const hash = sha256(serializeNep413({ message, recipient: 'localhost', nonce }));
    const signature = Uint8Array.from(atob(signed.signature), (char) => char.charCodeAt(0));
    expect(ed25519.verify(signature, hash, deriveNearKey(seed).publicKey)).toBe(true);
    expect(signed.publicKey).toBe(deriveNearKey(seed).nearPublicKey);
  });
});
