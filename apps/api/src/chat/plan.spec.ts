import { describe, expect, it } from 'vitest';
import { PLAN_TOOL_ID, planFromArgs, planGate } from './plan';

function gate(planApproved: boolean) {
  const ctx = { get: (key: string) => (key === 'planApproved' ? planApproved : undefined) };
  return planGate(ctx).beforeToolCall({ toolName: 'list-invoices', context: { requestContext: ctx } });
}

describe('plan gate', () => {
  it('blocks every non-plan tool until the plan is approved', () => {
    expect(gate(false)).toEqual({
      proceed: false,
      output: {
        error: 'Blocked: call plan-actions and get the plan approved before calling any other tool.',
      },
    });
  });

  it('allows tools after the plan is approved', () => {
    expect(gate(true)).toBeUndefined();
  });

  it('always allows the plan tool itself', () => {
    const ctx = { get: () => false };
    expect(
      planGate(ctx).beforeToolCall({
        toolName: PLAN_TOOL_ID,
        context: { requestContext: ctx },
      }),
    ).toBeUndefined();
  });

  it('normalizes a pending plan from model arguments', () => {
    const plan = planFromArgs(
      {
        goal: 'Read bills',
        steps: [{ title: 'List bills', tool: 'list-invoices', risk: 'read' }],
      },
      'call-1',
    );
    expect(plan).toMatchObject({
      id: 'call-1',
      goal: 'Read bills',
      status: 'pending',
      steps: [{ title: 'List bills', tool: 'list-invoices', risk: 'read' }],
    });
  });
});
