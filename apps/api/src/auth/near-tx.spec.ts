import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {
  buildTransaction,
  extractSuccessValue,
  NearRelayError,
  parseRelayerKey,
  signTransaction,
  validateSignAction,
} from './near-tx';

const config = { contractId: 'fast-auth.testnet', maxGas: 300_000_000_000_000n };

function action(overrides: Partial<Parameters<typeof validateSignAction>[0]> = {}) {
  return {
    receiverId: 'fast-auth.testnet',
    methodName: 'sign' as const,
    argsBase64: Buffer.from('{"guard_id":"auth0"}').toString('base64'),
    gas: '300000000000000',
    deposit: '0',
    ...overrides,
  };
}

describe('passkey relayer validation', () => {
  it('accepts a sign call to fast-auth within the gas cap', () => {
    expect(validateSignAction(action(), config)).toBeInstanceOf(Buffer);
  });

  it('rejects any other contract', () => {
    expect(() => validateSignAction(action({ receiverId: 'evil.near' }), config)).toThrow(
      NearRelayError,
    );
  });

  it('rejects any other method', () => {
    expect(() =>
      validateSignAction(action({ methodName: 'ft_transfer' as 'sign' }), config),
    ).toThrow(NearRelayError);
  });

  it('rejects gas above the cap and non-zero deposits', () => {
    expect(() => validateSignAction(action({ gas: '300000000000001' }), config)).toThrow(
      NearRelayError,
    );
    expect(() => validateSignAction(action({ deposit: '1' }), config)).toThrow(NearRelayError);
  });

  it('rejects oversized arguments', () => {
    const huge = Buffer.alloc(20_000, 1).toString('base64');
    expect(() => validateSignAction(action({ argsBase64: huge }), config)).toThrow(NearRelayError);
  });
});

describe('transaction building', () => {
  it('signs the borsh transaction hash', () => {
    const keyPair = nacl.sign.keyPair();
    const tx = buildTransaction({
      signerId: 'relayer.testnet',
      publicKey: Buffer.from(keyPair.publicKey),
      nonce: 7n,
      receiverId: 'fast-auth.testnet',
      blockHash: Buffer.alloc(32, 3),
      actions: [validateSignAction(action(), config)],
    });
    const signed = signTransaction(tx, keyPair.secretKey);
    const hash = createHash('sha256').update(tx).digest();
    const signature = signed.subarray(signed.length - 64);
    expect(nacl.sign.detached.verify(hash, signature, keyPair.publicKey)).toBe(true);
  });

  it('parses 32-byte seeds and 64-byte secret keys', () => {
    const keyPair = nacl.sign.keyPair();
    const fromSecret = parseRelayerKey(`ed25519:${bs58.encode(Buffer.from(keyPair.secretKey))}`);
    const fromSeed = parseRelayerKey(
      `ed25519:${bs58.encode(Buffer.from(keyPair.secretKey.subarray(0, 32)))}`,
    );
    expect(Buffer.from(fromSecret.publicKey)).toEqual(Buffer.from(keyPair.publicKey));
    expect(Buffer.from(fromSeed.publicKey)).toEqual(Buffer.from(keyPair.publicKey));
  });
});

describe('extractSuccessValue', () => {
  it('returns the MPC payload', () => {
    expect(
      extractSuccessValue({
        status: { SuccessValue: 'c2ln' },
        transaction_outcome: { id: 'abc' },
      }),
    ).toEqual({ successValue: 'c2ln', txHash: 'abc' });
  });

  it('rejects an empty signature', () => {
    expect(() => extractSuccessValue({ status: { SuccessValue: '' } })).toThrow(NearRelayError);
  });

  it('rejects a failed call', () => {
    expect(() => extractSuccessValue({ status: { Failure: {} } })).toThrow(NearRelayError);
  });
});
