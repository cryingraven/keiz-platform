import { AgentPolicy, parseUnits } from '@keiz/shared';

export interface PolicyInput {
  policy: AgentPolicy;
  amountUsd: string;
  asset: string;
  spentTodayUsd: string;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

const USD_SCALE = 2;

function toCents(value: string): bigint {
  return parseUnits(value, USD_SCALE);
}

/**
 * Pure function so it can be unit-tested and reused by both the API and the chat tools.
 * Order matters: hard blocks first, then the approval threshold.
 */
export function evaluatePolicy(
  input: PolicyInput,
  options?: { skipAssetCheck?: boolean },
): PolicyDecision {
  const { policy } = input;
  if (!policy.active) {
    return { allowed: false, requiresApproval: false, reason: 'Agent wallet is paused' };
  }
  if (!options?.skipAssetCheck && !policy.allowedAssets.includes(input.asset)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Asset ${input.asset} is not on the allowlist`,
    };
  }

  const amount = toCents(input.amountUsd);
  const perTx = toCents(policy.perTxLimitUsd);
  const daily = toCents(policy.dailyLimitUsd);
  const threshold = toCents(policy.approvalThresholdUsd);
  const spent = toCents(input.spentTodayUsd);

  if (amount > perTx) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Amount exceeds the per-transaction limit ($${policy.perTxLimitUsd})`,
    };
  }
  if (spent + amount > daily) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Daily limit would be exceeded ($${policy.dailyLimitUsd} / $${input.spentTodayUsd} used)`,
    };
  }
  if (amount > threshold) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Above the auto-approve threshold ($${policy.approvalThresholdUsd})`,
    };
  }
  return { allowed: true, requiresApproval: false, reason: 'Within policy limits' };
}
