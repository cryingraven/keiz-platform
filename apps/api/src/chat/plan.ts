import { randomUUID } from 'node:crypto';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  CHAT_RISKS,
  ChatPlan,
  chatPlanSchema,
  planCardSchema,
  chatToolErrorSchema,
} from '@keiz/shared';
import { planCard } from './cards';

export const PLAN_TOOL_ID = 'plan-actions';

export const planStepInputSchema = z.object({
  title: z.string().min(1).max(160),
  detail: z.string().max(500).optional(),
  tool: z.string().max(60).optional(),
  risk: z.enum(CHAT_RISKS).default('read'),
});

export const planInputSchema = z.object({
  goal: z.string().min(1).max(500),
  summary: z.string().max(500).optional(),
  steps: z.array(planStepInputSchema).min(1).max(12),
});

export type PlanInput = z.infer<typeof planInputSchema>;

const requestContextSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  accountId: z.string().min(1),
});

export function planFromArgs(args: Partial<PlanInput>, id: string): ChatPlan {
  return {
    id,
    goal: args.goal ?? 'Run this task',
    summary: args.summary,
    steps: (args.steps ?? []).map((step) => ({
      title: step.title,
      detail: step.detail,
      tool: step.tool,
      risk: step.risk ?? 'read',
    })),
    status: 'pending',
  };
}

export function createPlanTool() {
  return createTool({
    id: PLAN_TOOL_ID,
    description:
      'MANDATORY first tool for any request that needs workspace data or an action. ' +
      'Describe a short 1-5 step plan. Do not call any other tool until this plan is approved.',
    inputSchema: planInputSchema,
    outputSchema: planCardSchema.or(chatToolErrorSchema),
    requestContextSchema,
    requireApproval: true,
    execute: async (input, context) => {
      (context as { requestContext?: { set: (key: string, value: unknown) => void } })
        .requestContext?.set('planApproved', true);
      const plan: ChatPlan = {
        ...planFromArgs(input, randomUUID()),
        status: 'approved',
      };
      return planCard(plan);
    },
  });
}

/**
 * Blocks every tool except plan-actions until the plan itself has been approved.
 * The plan tool flips `planApproved` on the shared request context after execution.
 */
export function planGate(requestContext: {
  get: (key: string) => unknown;
}): {
  beforeToolCall: (input: {
    toolName: string;
    context?: { requestContext?: { get: (key: string) => unknown } };
  }) =>
    | { proceed: false; output: { error: string } }
    | undefined;
} {
  return {
    beforeToolCall: ({ toolName, context }) => {
      const ctx = context?.requestContext ?? requestContext;
      if (toolName === PLAN_TOOL_ID) return undefined;
      if (ctx?.get('planApproved') !== true) {
        return {
          proceed: false as const,
          output: {
            error:
              'Blocked: call plan-actions and get the plan approved before calling any other tool.',
          },
        };
      }
      return undefined;
    },
  };
}

export { chatPlanSchema };
