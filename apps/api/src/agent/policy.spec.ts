import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_POLICY } from '@keiz/shared';
import { evaluatePolicy } from './policy';

const policy = { ...DEFAULT_AGENT_POLICY, allowedAssets: ['usdc'] };

describe('agent policy', () => {
  it('allows a small payment without approval', () => {
    const result = evaluatePolicy({
      policy,
      amountUsd: '100.00',
      asset: 'usdc',
      spentTodayUsd: '0',
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('requires approval above the threshold but below the cap', () => {
    const result = evaluatePolicy({
      policy,
      amountUsd: '300.00',
      asset: 'usdc',
      spentTodayUsd: '0',
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it('blocks above the per-transaction limit', () => {
    const result = evaluatePolicy({
      policy,
      amountUsd: '500.01',
      asset: 'usdc',
      spentTodayUsd: '0',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('per-transaction');
  });

  it('blocks when the daily limit would be exceeded', () => {
    const result = evaluatePolicy({
      policy,
      amountUsd: '400.00',
      asset: 'usdc',
      spentTodayUsd: '1200.00',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily limit');
  });

  it('blocks assets outside the allowlist and paused wallets', () => {
    expect(
      evaluatePolicy({ policy, amountUsd: '10', asset: 'wnear', spentTodayUsd: '0' }).allowed,
    ).toBe(false);
    expect(
      evaluatePolicy({
        policy: { ...policy, active: false },
        amountUsd: '10',
        asset: 'usdc',
        spentTodayUsd: '0',
      }).allowed,
    ).toBe(false);
  });
});
