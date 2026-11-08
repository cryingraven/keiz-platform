import { describe, expect, it } from 'vitest';
import { RpcTransactionResult, verifyDepositTransaction } from './near-tx-verifier';

const claim = {
  txHash: 'abc',
  senderAccountId: 'alice.near',
  depositAddress: 'deposit.near',
  originAsset: 'nep141:usdc.near',
  minAmount: '1000000',
};

function tx(overrides: {
  receiver?: string;
  to?: string;
  amount?: string;
  method?: string;
  success?: boolean;
  finality?: string;
}): RpcTransactionResult {
  const args = Buffer.from(
    JSON.stringify({ receiver_id: overrides.to ?? 'deposit.near', amount: overrides.amount ?? '1000000' }),
  ).toString('base64');
  return {
    final_execution_status: overrides.finality ?? 'FINAL',
    transaction: {
      signer_id: 'alice.near',
      receiver_id: overrides.receiver ?? 'usdc.near',
      actions: [
        {
          FunctionCall: {
            method_name: overrides.method ?? 'ft_transfer',
            args,
          },
        },
      ],
    },
    transaction_outcome: {
      outcome: {
        status: overrides.success === false ? { Failure: {} } : { SuccessValue: '' },
      },
    },
  };
}

describe('verifyDepositTransaction', () => {
  it('accepts an ft_transfer to the deposit address for the quoted amount', () => {
    expect(verifyDepositTransaction(tx({}), claim).ok).toBe(true);
  });

  it('accepts ft_transfer_call', () => {
    expect(verifyDepositTransaction(tx({ method: 'ft_transfer_call' }), claim).ok).toBe(true);
  });

  it('rejects a different recipient', () => {
    expect(verifyDepositTransaction(tx({ to: 'attacker.near' }), claim).ok).toBe(false);
  });

  it('rejects an underpayment', () => {
    const result = verifyDepositTransaction(tx({ amount: '999999' }), claim);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('below');
  });

  it('rejects a failed transaction', () => {
    expect(verifyDepositTransaction(tx({ success: false }), claim).ok).toBe(false);
  });

  it('rejects a non-final transaction', () => {
    expect(verifyDepositTransaction(tx({ finality: 'INCLUDED' }), claim).ok).toBe(false);
  });

  it('rejects a transfer on the wrong token contract', () => {
    expect(verifyDepositTransaction(tx({ receiver: 'wrap.near' }), claim).ok).toBe(false);
  });

  it('rejects a transaction signed by a different payer', () => {
    const result = verifyDepositTransaction(tx({}), {
      ...claim,
      senderAccountId: 'mallory.near',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('claimed payer');
  });

  it('rejects a transaction with no ft_transfer', () => {
    expect(
      verifyDepositTransaction(
        { transaction: { actions: [{ Transfer: {} }] }, transaction_outcome: { outcome: { status: { SuccessValue: '' } } } },
        claim,
      ).ok,
    ).toBe(false);
  });

  it('rejects a non-NEP-141 origin asset', () => {
    expect(
      verifyDepositTransaction(tx({}), { ...claim, originAsset: 'near' }).ok,
    ).toBe(false);
  });
});
