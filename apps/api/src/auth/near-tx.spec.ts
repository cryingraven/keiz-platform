import { describe, expect, it } from 'vitest';
import { NearRelayError, validateSignAction } from './near-tx';

const config = {
  contractId: 'fast-auth.testnet',
  maxGas: 300_000_000_000_000n,
  allowedGuardId: 'jwt#https://login.testnet.fast-auth.com/',
};

function args(guardId = config.allowedGuardId): string {
  return Buffer.from(
    JSON.stringify({ guard_id: guardId, verify_payload: 'jwt', sign_payload: [1, 2, 3] }),
  ).toString('base64');
}

function action(overrides: Partial<Parameters<typeof validateSignAction>[0]> = {}) {
  return {
    receiverId: 'fast-auth.testnet',
    methodName: 'sign',
    argsBase64: args(),
    gas: '100000000000000',
    deposit: '1',
    ...overrides,
  };
}

describe('NEAR Auth relayer validation', () => {
  it('accepts a bounded sign call to the configured contract', () => {
    expect(() => validateSignAction(action(), config)).not.toThrow();
  });

  it('rejects other contracts', () => {
    expect(() => validateSignAction(action({ receiverId: 'evil.near' }), config)).toThrow(
      NearRelayError,
    );
  });

  it('rejects methods other than sign', () => {
    expect(() => validateSignAction(action({ methodName: 'transfer' }), config)).toThrow(
      /only forwards sign/,
    );
  });

  it('rejects gas above the cap', () => {
    expect(() => validateSignAction(action({ gas: '300000000000001' }), config)).toThrow(
      /outside the allowed range/,
    );
  });

  it('requires a 1 yoctoNEAR deposit', () => {
    expect(() => validateSignAction(action({ deposit: '0' }), config)).toThrow(/1 yoctoNEAR/);
    expect(() => validateSignAction(action({ deposit: '2' }), config)).toThrow(/1 yoctoNEAR/);
  });

  it('rejects an unexpected guard id', () => {
    expect(() =>
      validateSignAction(action({ argsBase64: args('jwt#https://evil.example/') }), config),
    ).toThrow(/Unknown Auth0 guard id/);
  });

  it('rejects non-JSON arguments', () => {
    expect(() =>
      validateSignAction(action({ argsBase64: Buffer.from('not-json').toString('base64') }), config),
    ).toThrow(/not JSON/);
  });
});
