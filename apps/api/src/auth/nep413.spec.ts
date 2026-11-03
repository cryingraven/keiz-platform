import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { signNep413WithSecret, verifyNep413 } from './nep413';

const keyPair = nacl.sign.keyPair();
const payload = {
  message: 'localhost wants you to sign in with your NEAR account:\nalice.near',
  recipient: 'localhost',
  nonce: new Uint8Array(32).fill(7),
};

describe('NEP-413', () => {
  it('verifies a signature produced over the borsh payload', () => {
    const signed = signNep413WithSecret(payload, keyPair.secretKey);
    expect(verifyNep413(payload, signed.publicKey, signed.signature)).toBe(true);
  });

  it('rejects a tampered message', () => {
    const signed = signNep413WithSecret(payload, keyPair.secretKey);
    expect(
      verifyNep413({ ...payload, message: payload.message + '!' }, signed.publicKey, signed.signature),
    ).toBe(false);
  });

  it('rejects a different recipient (phishing protection)', () => {
    const signed = signNep413WithSecret(payload, keyPair.secretKey);
    expect(
      verifyNep413({ ...payload, recipient: 'evil.example' }, signed.publicKey, signed.signature),
    ).toBe(false);
  });

  it('rejects a different nonce', () => {
    const signed = signNep413WithSecret(payload, keyPair.secretKey);
    expect(
      verifyNep413(
        { ...payload, nonce: new Uint8Array(32).fill(8) },
        signed.publicKey,
        signed.signature,
      ),
    ).toBe(false);
  });

  it('rejects malformed keys and signatures', () => {
    const signed = signNep413WithSecret(payload, keyPair.secretKey);
    expect(() => verifyNep413(payload, 'ed25519:not-a-key', signed.signature)).toThrow();
    expect(() => verifyNep413(payload, signed.publicKey, 'AAAA')).toThrow();
  });
});
