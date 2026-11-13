import { describe, expect, it } from 'vitest';
import { parseUnits } from '@keiz/shared';
import {
  DEFAULT_FT_STORAGE_DEPOSIT,
  NEAR_TRANSFER_RESERVE,
  buildTransferTransactions,
  buildWalletAssets,
  explorerTxUrl,
  maxSendable,
  validateTransfer,
  type WalletAsset,
} from './wallet';

const nearAsset: WalletAsset = {
  key: 'near',
  kind: 'near',
  symbol: 'NEAR',
  name: 'NEAR',
  decimals: 24,
  balance: parseUnits('10', 24).toString(),
};

const usdcAsset: WalletAsset = {
  key: 'usdc',
  kind: 'token',
  contractId: 'usdc.near',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  balance: '2500000',
};

describe('wallet transfer helpers', () => {
  it('builds a native NEAR transfer', () => {
    const [transaction] = buildTransferTransactions({
      asset: nearAsset,
      recipient: 'bob.near',
      amount: '1.5',
    });

    expect(transaction).toEqual({
      receiverId: 'bob.near',
      actions: [
        {
          type: 'Transfer',
          params: { deposit: parseUnits('1.5', 24).toString() },
        },
      ],
    });
  });

  it('builds an NEP-141 ft_transfer with a 1 yocto deposit', () => {
    const [transaction] = buildTransferTransactions({
      asset: usdcAsset,
      recipient: 'bob.near',
      amount: '1.25',
    });

    expect(transaction.receiverId).toBe('usdc.near');
    expect(transaction.actions).toEqual([
      {
        type: 'FunctionCall',
        params: {
          methodName: 'ft_transfer',
          args: { receiver_id: 'bob.near', amount: '1250000' },
          gas: '30000000000000',
          deposit: '1',
        },
      },
    ]);
  });

  it('adds storage_deposit before ft_transfer when requested', () => {
    const [transaction] = buildTransferTransactions({
      asset: usdcAsset,
      recipient: 'bob.near',
      amount: '1',
      registerStorage: true,
      storageDeposit: '2000000000000000000000',
    });

    expect(transaction.actions).toHaveLength(2);
    expect(transaction.actions[0]).toMatchObject({
      type: 'FunctionCall',
      params: {
        methodName: 'storage_deposit',
        args: { account_id: 'bob.near' },
        deposit: '2000000000000000000000',
      },
    });
    expect(transaction.actions[1]).toMatchObject({
      params: { methodName: 'ft_transfer' },
    });
  });

  it('falls back to the default storage deposit', () => {
    const [transaction] = buildTransferTransactions({
      asset: usdcAsset,
      recipient: 'bob.near',
      amount: '1',
      registerStorage: true,
    });

    expect(transaction.actions[0].params.deposit).toBe(DEFAULT_FT_STORAGE_DEPOSIT.toString());
  });

  it('rejects an amount that would eat the NEAR fee reserve', () => {
    const message = validateTransfer({
      asset: nearAsset,
      recipient: 'bob.near',
      amount: '9.99',
    });

    expect(message).toMatch(/0\.05 NEAR/);
    expect(() =>
      buildTransferTransactions({ asset: nearAsset, recipient: 'bob.near', amount: '9.99' }),
    ).toThrow(/0\.05 NEAR/);
  });

  it('rejects a token amount above the balance', () => {
    expect(
      validateTransfer({ asset: usdcAsset, recipient: 'bob.near', amount: '3' }),
    ).toMatch(/only have/);
  });

  it('rejects malformed recipients and amounts', () => {
    expect(
      validateTransfer({ asset: nearAsset, recipient: 'NOT A CONTRACT', amount: '1' }),
    ).toMatch(/valid NEAR/);
    expect(
      validateTransfer({ asset: nearAsset, recipient: 'bob.near', amount: '0' }),
    ).toMatch(/positive amount/);
    expect(
      validateTransfer({ asset: usdcAsset, recipient: 'bob.near', amount: '1.1234567' }),
    ).toMatch(/decimal places/);
  });

  it('computes a max that keeps the fee reserve for NEAR only', () => {
    expect(maxSendable(nearAsset)).toBe(parseUnits('10', 24) - NEAR_TRANSFER_RESERVE);
    expect(maxSendable(usdcAsset)).toBe(2500000n);
  });

  it('maps the API overview to assets', () => {
    const assets = buildWalletAssets({
      accountId: 'alice.near',
      network: 'mainnet',
      exists: true,
      near: { total: '10', available: '8', staked: '2', storageBytes: 1 },
      tokens: [
        {
          contractId: 'usdc.near',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          balance: '1',
        },
      ],
      partial: false,
      fetchedAt: new Date().toISOString(),
    });

    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({ kind: 'near', balance: '8' });
    expect(assets[1]).toMatchObject({ kind: 'token', contractId: 'usdc.near', balance: '1' });
  });

  it('only links well-formed transaction hashes to NEARBlocks', () => {
    expect(explorerTxUrl('8sF2mV9j4XbYq1c7uZp3nKd6aQwErTyUiOpAsDfGhJk', 'mainnet')).toBe(
      'https://nearblocks.io/txns/8sF2mV9j4XbYq1c7uZp3nKd6aQwErTyUiOpAsDfGhJk',
    );
    expect(explorerTxUrl('tx-0')).toBeNull();
    expect(explorerTxUrl('bad hash with spaces')).toBeNull();
  });
});
