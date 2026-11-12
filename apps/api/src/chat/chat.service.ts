import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RequestContext } from '@mastra/core/request-context';
import { randomUUID } from 'node:crypto';
import {
  ChatApprovalRequest,
  ChatCard,
  ChatMessageView,
  ChatPlan,
  ChatRequestContext,
  ChatStreamEvent,
  ChatThreadView,
  chatCardSchema,
} from './chat.types';
import { KeizMastra, MASTRA } from './mastra.provider';
import { mapChunk } from './stream-mapper';
import {
  describeToolCall,
  needsConfirmation,
  normalizeToolName,
  planCard,
  toolRisk,
} from './cards';
import { planFromArgs, PlanInput, PLAN_TOOL_ID } from './plan';
import { LocalAction, LocalActionResult, LocalRunStore } from './local-runs';
import type { ChatTools } from './tools';

export interface StreamInput {
  orgId: string;
  userId: string;
  accountId: string;
  role: string;
  message: string;
  threadId?: string;
  abortSignal?: AbortSignal;
}

export interface ApprovalInput {
  orgId: string;
  userId: string;
  accountId: string;
  role: string;
  threadId: string;
  runId: string;
  toolCallId: string;
  approved: boolean;
  reason?: string;
}

interface LocalResult {
  events: ChatStreamEvent[];
  text: string;
}

interface MastraStreamLike {
  fullStream: AsyncIterable<unknown>;
  runId?: string;
  usage?: Promise<unknown>;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly localRuns = new LocalRunStore();

  constructor(@Inject(MASTRA) private readonly keiz: KeizMastra) {
    this.logger.log(`Chat provider: ${keiz.provider} (${keiz.modelId})`);
  }

  get provider(): 'mastra' | 'local' {
    return this.keiz.provider;
  }

  private resourceId(orgId: string, userId: string): string {
    return `org:${orgId}:user:${userId}`;
  }

  private context(input: {
    orgId: string;
    userId: string;
    accountId: string;
    role: string;
  }): RequestContext<ChatRequestContext> {
    const ctx = new RequestContext<ChatRequestContext>();
    ctx.set('orgId', input.orgId);
    ctx.set('userId', input.userId);
    ctx.set('accountId', input.accountId);
    ctx.set('role', input.role);
    ctx.set('planApproved', false);
    return ctx;
  }

  async listThreads(orgId: string, userId: string): Promise<ChatThreadView[]> {
    const { threads } = await this.keiz.memory.listThreads({
      filter: { resourceId: this.resourceId(orgId, userId) },
      page: 0,
      perPage: 50,
    });
    return threads.map((thread) => ({
      _id: thread.id,
      title: thread.title ?? 'Untitled conversation',
      updatedAt: (thread.updatedAt ?? thread.createdAt ?? new Date()).toISOString(),
    }));
  }

  async getThread(orgId: string, userId: string, threadId: string) {
    const resourceId = this.resourceId(orgId, userId);
    const thread = await this.keiz.memory.getThreadById({ threadId, resourceId });
    if (!thread) throw new NotFoundException('Thread not found');

    const { messages } = await this.keiz.memory.recall({
      threadId,
      resourceId,
      page: 0,
      perPage: 100,
    });

    return {
      _id: thread.id,
      title: thread.title ?? 'Untitled conversation',
      messages: messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => this.toView(message)),
    };
  }

  async deleteThread(orgId: string, userId: string, threadId: string) {
    const thread = await this.keiz.memory.getThreadById({
      threadId,
      resourceId: this.resourceId(orgId, userId),
    });
    if (!thread) throw new NotFoundException('Thread not found');
    await this.keiz.memory.deleteThread(threadId);
    return { ok: true };
  }

  private toView(message: {
    id: string;
    role: string;
    createdAt?: Date;
    content?: unknown;
  }): ChatMessageView {
    const parts = ((message.content as { parts?: unknown[] } | undefined)?.parts ?? []) as Array<
      Record<string, unknown>
    >;
    let content = '';
    const toolCalls: ChatMessageView['toolCalls'] = [];
    for (const part of parts) {
      if (part.type === 'text' && typeof part.text === 'string') {
        content += part.text;
      }
      if (part.type === 'tool-invocation') {
        const invocation = (part.toolInvocation ?? part) as Record<string, unknown>;
        toolCalls.push({
          name: String(invocation.toolName ?? 'tool'),
          args: (invocation.args ?? {}) as Record<string, unknown>,
          result: invocation.result ?? null,
        });
      }
    }
    return {
      _id: message.id,
      role: message.role === 'user' ? 'user' : 'assistant',
      content,
      toolCalls,
      at: (message.createdAt ?? new Date()).toISOString(),
    };
  }

  async *streamEvents(input: StreamInput): AsyncGenerator<ChatStreamEvent> {
    const threadId = input.threadId ?? randomUUID();
    const resourceId = this.resourceId(input.orgId, input.userId);

    const existing = await this.keiz.memory.getThreadById({ threadId, resourceId });
    if (!existing) {
      await this.keiz.memory.saveThread({
        thread: {
          id: threadId,
          resourceId,
          title: input.message.slice(0, 64) || 'New conversation',
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {},
        },
      });
    }

    yield { type: 'meta', provider: this.keiz.provider, modelId: this.keiz.modelId };
    yield { type: 'thread', threadId };

    if (this.keiz.provider === 'local') {
      yield* this.localStream(input, threadId, resourceId);
      return;
    }

    const ctx = this.context(input);
    try {
      const stream = (await this.keiz.agent.stream(
        [{ role: 'user', content: input.message }],
        {
          memory: { thread: threadId, resource: resourceId },
          requestContext: ctx,
          abortSignal: input.abortSignal,
          hooks: this.gate(ctx),
        } as never,
      )) as unknown as MastraStreamLike;
      yield* this.mapMastraStream(stream, threadId, ctx);
    } catch (error) {
      if (input.abortSignal?.aborted) return;
      this.logger.warn(`Mastra stream failed: ${(error as Error).message}`);
      yield { type: 'error', message: this.friendlyError(error) };
    }
  }

  async *streamApproval(input: ApprovalInput): AsyncGenerator<ChatStreamEvent> {
    yield { type: 'meta', provider: this.keiz.provider, modelId: this.keiz.modelId };
    yield { type: 'thread', threadId: input.threadId };

    if (this.keiz.provider === 'local') {
      yield* this.localApproval(input);
      return;
    }

    const resourceId = this.resourceId(input.orgId, input.userId);
    const suspended = await this.keiz.agent.listSuspendedRuns({
      threadId: input.threadId,
      resourceId,
      page: 0,
      perPage: 50,
    });
    const run = suspended.runs.find(
      (candidate) =>
        candidate.runId === input.runId &&
        candidate.toolCalls.some((call) => call.toolCallId === input.toolCallId),
    );
    if (!run) {
      throw new NotFoundException('Approval not found or already resolved');
    }
    const call = run.toolCalls.find((candidate) => candidate.toolCallId === input.toolCallId);
    yield {
      type: 'approval_result',
      toolCallId: input.toolCallId,
      approved: input.approved,
      reason: input.reason,
    };
    const ctx = this.context(input);
    // Approving the plan opens the gate for the rest of the run. Declining it keeps it closed.
    ctx.set(
      'planApproved',
      call?.toolName === PLAN_TOOL_ID ? input.approved : true,
    );

    try {
      const stream = (input.approved
        ? await this.keiz.agent.approveToolCall({
            runId: input.runId,
            toolCallId: input.toolCallId,
            memory: { thread: input.threadId, resource: resourceId },
            requestContext: ctx,
            hooks: this.gate(ctx),
          } as never)
        : await this.keiz.agent.declineToolCall({
            runId: input.runId,
            toolCallId: input.toolCallId,
            reason: input.reason,
            memory: { thread: input.threadId, resource: resourceId },
            requestContext: ctx,
            hooks: this.gate(ctx),
          } as never)) as unknown as MastraStreamLike;
      yield* this.mapMastraStream(stream, input.threadId, ctx, input.runId);
    } catch (error) {
      this.logger.warn(`Approval resume failed: ${(error as Error).message}`);
      yield { type: 'error', message: this.friendlyError(error) };
    }
  }

  async listPendingApprovals(
    orgId: string,
    userId: string,
    threadId: string,
  ): Promise<ChatApprovalRequest[]> {
    if (this.keiz.provider === 'local') {
      return this.localRuns.listForThread(orgId, userId, threadId).flatMap((run) => {
        const action = run.actions[run.index];
        if (!action) return [];
        return [this.approvalRequest(run.runId, threadId, run.index, action)];
      });
    }

    const suspended = await this.keiz.agent.listSuspendedRuns({
      threadId,
      resourceId: this.resourceId(orgId, userId),
      page: 0,
      perPage: 50,
    });
    return suspended.runs.flatMap((run) =>
      run.toolCalls
        .filter((call) => call.requiresApproval && call.toolCallId)
        .map((call) => {
          const name = call.toolName ?? 'tool';
          const args = (call.args ?? {}) as Record<string, unknown>;
          return {
            runId: run.runId,
            threadId,
            toolCallId: String(call.toolCallId),
            name,
            args,
            summary: describeToolCall(name, args),
            risk: toolRisk(name),
            planId: name === PLAN_TOOL_ID ? String(call.toolCallId) : undefined,
          };
        }),
    );
  }

  private approvalRequest(
    runId: string,
    threadId: string,
    index: number,
    action: LocalAction,
  ): ChatApprovalRequest {
    return {
      runId,
      threadId,
      toolCallId: `${runId}:${index}`,
      name: action.name,
      args: action.args,
      summary: describeToolCall(action.name, action.args),
      risk: toolRisk(action.name),
      planId: index === 0 ? `${runId}:0` : undefined,
    };
  }

  private gate(ctx: RequestContext<ChatRequestContext>): Record<string, unknown> {
    const context = {
      get: (key: string) => ctx.get(key as never),
    };
    return {
      beforeToolCall: ({
        toolName,
        context: executionContext,
      }: {
        toolName: string;
        context?: { requestContext?: { get: (key: string) => unknown } };
      }) => {
        const active = executionContext?.requestContext ?? context;
        const normalized = normalizeToolName(toolName);
        if (normalized === PLAN_TOOL_ID) return undefined;
        if (active.get('planApproved') !== true) {
          return {
            proceed: false as const,
            output: {
              error:
                'Blocked: call plan-actions and get the plan approved before calling any other tool.',
            },
          };
        }
        if (
          ['create-vendor', 'hire-agent'].includes(normalized) &&
          !['ADMIN', 'OWNER'].includes(String(active.get('role')))
        ) {
          return {
            proceed: false as const,
            output: {
              error:
                normalized === 'create-vendor'
                  ? 'Only an ADMIN or OWNER can create vendors. Ask a workspace admin to add it.'
                  : 'Only an ADMIN or OWNER can hire agents.',
            },
          };
        }
        return undefined;
      },
    };
  }

  private async *mapMastraStream(
    stream: MastraStreamLike,
    threadId: string,
    ctx: RequestContext<ChatRequestContext>,
    fallbackRunId?: string,
  ): AsyncGenerator<ChatStreamEvent> {
    const runId = stream.runId ?? fallbackRunId ?? '';
    let pending = 0;
    for await (const chunk of stream.fullStream) {
      const event = mapChunk(chunk, { runId, threadId });
      if (!event) continue;
      if (event.type === 'tool' && event.phase === 'call' && event.name === PLAN_TOOL_ID) {
        const toolCallId = String(event.args.__toolCallId ?? randomUUID());
        yield {
          type: 'plan',
          plan: planFromArgs(event.args as unknown as PlanInput, toolCallId),
        };
        yield event;
        continue;
      }
      if (event.type === 'tool' && event.phase === 'result') {
        yield event;
        const card = this.extractCard(event.result);
        if (card) yield { type: 'card', card };
        continue;
      }
      if (event.type === 'approval') {
        pending += 1;
        yield event;
        continue;
      }
      yield event;
    }
    const usage = stream.usage ? await stream.usage.catch(() => undefined) : undefined;
    yield { type: 'done', threadId, usage, suspended: pending > 0 };
    void ctx;
  }

  private extractCard(result: unknown): ChatCard | null {
    const parsed = chatCardSchema.safeParse(result);
    return parsed.success ? parsed.data : null;
  }

  private friendlyError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'The assistant failed';
    if (/api key|401|unauthorized/i.test(message)) {
      return 'NEAR AI rejected the request. Check NEARAI_API_KEY, or set CHAT_PROVIDER=local for the offline demo.';
    }
    return message;
  }

  // ---------------------------------------------------------------------------
  // Offline provider: same tools, same plan/approval protocol.
  // ---------------------------------------------------------------------------

  private async *localStream(
    input: StreamInput,
    threadId: string,
    resourceId: string,
  ): AsyncGenerator<ChatStreamEvent> {
    const requestContext = this.context(input);
    const turn = await this.buildLocalTurn(input.message, requestContext);
    const runId = randomUUID();
    const plan: ChatPlan = { ...turn.plan, id: `${runId}:plan`, status: 'pending' };
    const planAction: LocalAction = {
      name: PLAN_TOOL_ID,
      args: { goal: plan.goal, summary: plan.summary, steps: plan.steps },
      run: async () => planCard({ ...plan, status: 'approved' }),
    };
    const actions = [planAction, ...turn.actions];
    this.localRuns.create({
      runId,
      orgId: input.orgId,
      userId: input.userId,
      threadId,
      userText: input.message,
      plan,
      actions,
      results: [],
      index: 0,
      render: turn.render,
    });

    yield { type: 'plan', plan };
    yield {
      type: 'approval',
      approval: this.approvalRequest(runId, threadId, 0, planAction),
    };
    yield { type: 'done', threadId, suspended: true };
    void resourceId;
  }

  private async *localApproval(input: ApprovalInput): AsyncGenerator<ChatStreamEvent> {
    const run = this.localRuns.get(input.runId);
    if (!run || run.orgId !== input.orgId || run.userId !== input.userId) {
      yield { type: 'error', message: 'Approval not found or already resolved' };
      return;
    }
    const current = run.actions[run.index];
    if (!current || `${run.runId}:${run.index}` !== input.toolCallId) {
      yield { type: 'error', message: 'This approval is stale; start a new request.' };
      return;
    }

    yield {
      type: 'approval_result',
      toolCallId: input.toolCallId,
      approved: input.approved,
      reason: input.reason,
    };

    if (!input.approved) {
      this.localRuns.delete(run.runId);
      const text =
        run.index === 0
          ? 'Plan cancelled. Tell me what to change.'
          : `Cancelled ${describeToolCall(current.name, current.args)}.`;
      await this.persistLocal(input, run.userText, text);
      yield* this.textEvents(text);
      yield { type: 'done', threadId: input.threadId };
      return;
    }

    if (run.index === 0) {
      const card = (await current.run()) as ChatCard;
      run.results.push(card);
      run.plan = { ...run.plan, status: 'approved' };
      yield { type: 'card', card };
      run.index += 1;
    } else {
      // A write/draft action was just approved.
      yield* this.executeLocalAction(run, current);
      run.index += 1;
    }

    // Reads run automatically after plan approval. Stop at the next write.
    while (run.index < run.actions.length) {
      const next = run.actions[run.index];
      if (needsConfirmation(next.name)) {
        yield {
          type: 'approval',
          approval: this.approvalRequest(run.runId, input.threadId, run.index, next),
        };
        yield { type: 'done', threadId: input.threadId, suspended: true };
        return;
      }
      yield* this.executeLocalAction(run, next);
      run.index += 1;
    }

    this.localRuns.delete(run.runId);
    const text = run.render(run.results);
    await this.persistLocal(input, run.userText, text);
    yield* this.textEvents(text);
    yield { type: 'done', threadId: input.threadId };
  }

  private async *executeLocalAction(
    run: { results: LocalActionResult[] },
    action: LocalAction,
  ): AsyncGenerator<ChatStreamEvent> {
    const result = await action.run();
    run.results.push(result);
    yield { type: 'tool', phase: 'call', name: action.name, args: action.args };
    yield { type: 'tool', phase: 'result', name: action.name, result };
    if (!('error' in result)) yield { type: 'card', card: result };
  }

  private async persistLocal(
    input: ApprovalInput,
    userText: string,
    assistantText: string,
  ): Promise<void> {
    const resourceId = this.resourceId(input.orgId, input.userId);
    const now = Date.now();
    await this.keiz.memory.saveMessages({
      messages: [
        {
          id: randomUUID(),
          threadId: input.threadId,
          resourceId,
          role: 'user',
          createdAt: new Date(now),
          content: { format: 2, parts: [{ type: 'text', text: userText }] },
        },
        {
          id: randomUUID(),
          threadId: input.threadId,
          resourceId,
          role: 'assistant',
          createdAt: new Date(now + 1),
          content: { format: 2, parts: [{ type: 'text', text: assistantText }] },
        },
      ] as never,
    });
  }

  private async *textEvents(text: string): AsyncGenerator<ChatStreamEvent> {
    for (const chunk of text.match(/\s+|\S+/g) ?? []) {
      yield { type: 'text', delta: chunk };
    }
  }

  private toolExecute(name: keyof ChatTools) {
    const tool = this.keiz.tools[name];
    return tool.execute as unknown as (
      input: Record<string, unknown>,
      context: unknown,
    ) => Promise<ChatCard | { error: string }>;
  }

  private async buildLocalTurn(
    message: string,
    requestContext: RequestContext<ChatRequestContext>,
  ): Promise<{
    plan: Omit<ChatPlan, 'id' | 'status'>;
    actions: LocalAction[];
    render: (results: LocalActionResult[]) => string;
  }> {
    const context = { requestContext } as never;
    const lower = message.toLowerCase();
    const invoiceNumber = message.match(/INV[-_ ]?\d+/i)?.[0]?.replace(/[ _]/g, '-').toUpperCase();
    const receivableNumber = message
      .match(/AR[-_ ]?\d+/i)?.[0]
      ?.replace(/[ _]/g, '-')
      .toUpperCase();

    const action = (
      name: keyof ChatTools,
      args: Record<string, unknown>,
    ): LocalAction => ({
      name,
      args,
      run: () => this.toolExecute(name)(args, context),
    });

    const renderCards = (results: LocalActionResult[], skipPlan = true): string => {
      const cards = results
        .slice(skipPlan ? 1 : 0)
        .filter((result): result is ChatCard => !('error' in result));
      const errors = results
        .slice(skipPlan ? 1 : 0)
        .filter((result): result is { error: string } => 'error' in result)
        .map((result) => result.error);
      return [
        ...cards.map((card) => `${card.title}${card.subtitle ? ` — ${card.subtitle}` : ''}`),
        ...errors,
      ].join('\n');
    };

    if (
      /\b(create|add|new)\s+(a\s+|an\s+)?(vendor|customer|bill|invoice|receivable)\b/.test(
        lower,
      )
    ) {
      return {
        plan: {
          goal: 'Create a record',
          steps: [{ title: 'Check the configured chat provider', risk: 'read' }],
        },
        actions: [],
        render: () =>
          'Creating vendors, customers, bills or customer invoices needs the NEAR AI agent. Set NEARAI_API_KEY and restart the API, or use the dashboard forms.',
      };
    }

    if ((/^pay\b|pay invoice|propose/.test(lower) || lower.includes('pay inv')) && invoiceNumber) {
      return {
        plan: {
          goal: `Create a payment proposal for ${invoiceNumber}`,
          summary: 'This only creates a proposal; a human still approves and executes it.',
          steps: [
            {
              title: `Review ${invoiceNumber}`,
              detail: 'Confirm the bill is APPROVED and the amount is correct.',
              tool: 'get-invoice',
              risk: 'read',
            },
            {
              title: 'Create the payment proposal',
              detail: 'Queue an agent action. No funds move.',
              tool: 'propose-payment',
              risk: 'spend',
            },
          ],
        },
        actions: [
          action('getInvoice', { number: invoiceNumber }),
          action('proposePayment', {
            invoiceNumber,
            reason: 'Requested from chat',
          }),
        ],
        render: (results) => {
          const last = results[results.length - 1];
          if (last && 'error' in last) return last.error;
          return `Proposed ${invoiceNumber}. Open Agent to approve or execute — chat cannot move funds.`;
        },
      };
    }

    if (invoiceNumber) {
      return {
        plan: {
          goal: `Read invoice ${invoiceNumber}`,
          steps: [{ title: `Fetch ${invoiceNumber}`, tool: 'get-invoice', risk: 'read' }],
        },
        actions: [action('getInvoice', { number: invoiceNumber })],
        render: (results) => this.localInvoiceText(results),
      };
    }

    if (receivableNumber) {
      return {
        plan: {
          goal: `Read receivable ${receivableNumber}`,
          steps: [
            { title: `Fetch ${receivableNumber}`, tool: 'get-receivable', risk: 'read' },
          ],
        },
        actions: [action('getReceivable', { number: receivableNumber })],
        render: (results) => this.localReceivableText(results),
      };
    }

    if (
      lower.includes('book') ||
      lower.includes('cash') ||
      lower.includes('ledger') ||
      lower.includes('balance') ||
      lower.includes('trial')
    ) {
      return {
        plan: {
          goal: 'Read the ledger and trial balance',
          steps: [{ title: 'Load ledger balances', tool: 'books-summary', risk: 'read' }],
        },
        actions: [action('booksSummary', {})],
        render: (results) => this.localBooksText(results),
      };
    }

    if (lower.includes('journal') || lower.includes('posting')) {
      return {
        plan: {
          goal: 'Read recent journal entries',
          steps: [{ title: 'Load journal', tool: 'journal-summary', risk: 'read' }],
        },
        actions: [action('journalSummary', { limit: 20 })],
        render: (results) => renderCards(results),
      };
    }

    if (lower.includes('spend') || lower.includes('summary') || lower.includes('burn')) {
      return {
        plan: {
          goal: 'Summarise spend by invoice status',
          steps: [{ title: 'Load spend totals', tool: 'spend-summary', risk: 'read' }],
        },
        actions: [action('spendSummary', {})],
        render: (results) => renderCards(results),
      };
    }

    if (lower.includes('customer')) {
      return {
        plan: {
          goal: 'List customers',
          steps: [{ title: 'Load customers', tool: 'list-customers', risk: 'read' }],
        },
        actions: [action('listCustomers', {})],
        render: (results) => renderCards(results),
      };
    }

    if (lower.includes('receivable') || lower.includes('ar ')) {
      return {
        plan: {
          goal: 'List customer invoices',
          steps: [{ title: 'Load receivables', tool: 'list-receivables', risk: 'read' }],
        },
        actions: [action('listReceivables', {})],
        render: (results) => renderCards(results),
      };
    }

    if (lower.includes('payment') || lower.includes('settle')) {
      return {
        plan: {
          goal: 'List payments',
          steps: [{ title: 'Load payments', tool: 'list-payments', risk: 'read' }],
        },
        actions: [action('listPayments', {})],
        render: (results) => renderCards(results),
      };
    }

    if (lower.includes('agent') || lower.includes('proposal') || lower.includes('action')) {
      return {
        plan: {
          goal: 'List agent actions',
          steps: [{ title: 'Load agent actions', tool: 'list-agent-actions', risk: 'read' }],
        },
        actions: [action('listAgentActions', {})],
        render: (results) => renderCards(results),
      };
    }

    if (lower.includes('vendor')) {
      return {
        plan: {
          goal: 'List vendors',
          steps: [{ title: 'Load vendors', tool: 'list-vendors', risk: 'read' }],
        },
        actions: [action('listVendors', {})],
        render: (results) => renderCards(results),
      };
    }

    if (lower.includes('pending') || lower.includes('approve') || lower.includes('waiting')) {
      return {
        plan: {
          goal: 'Show bills waiting for approval',
          steps: [
            { title: 'Load SUBMITTED bills', tool: 'list-invoices', risk: 'read' },
          ],
        },
        actions: [action('listInvoices', { status: 'SUBMITTED' })],
        render: (results) => renderCards(results),
      };
    }

    return {
      plan: {
        goal: 'Review the latest bills',
        steps: [{ title: 'Load the five latest bills', tool: 'list-invoices', risk: 'read' }],
      },
      actions: [action('listInvoices', { limit: 5 })],
      render: (results) => {
        const text = renderCards(results);
        return `I can help with bills, receivables, customers, vendors, payments, agent actions, spend, books and payment proposals.\n${text}\nTry: "show pending invoices", "spend summary", "books summary", or "pay BIL-26/11/00001". Creating records needs the NEAR AI agent.`;
      },
    };
  }

  private localInvoiceText(results: LocalActionResult[]): string {
    const card = results[results.length - 1];
    if (!card || 'error' in card) return card?.error ?? 'Invoice not found.';
    if (card.kind !== 'invoice') return card.title;
    const invoice = card.data.invoice;
    return [
      invoice.number,
      `Status: ${invoice.status}`,
      `Total: ${invoice.total.currency} ${invoice.total.formatted}`,
      `Due: ${invoice.dueDate.slice(0, 10)}`,
    ].join('\n');
  }

  private localReceivableText(results: LocalActionResult[]): string {
    const card = results[results.length - 1];
    if (!card || 'error' in card) return card?.error ?? 'Receivable not found.';
    if (card.kind !== 'receivable') return card.title;
    const row = card.data.receivable;
    return [
      row.number,
      `Status: ${row.status}`,
      `Outstanding: ${row.outstanding.currency} ${row.outstanding.formatted}`,
      `Due: ${row.dueDate.slice(0, 10)}`,
    ].join('\n');
  }

  private localBooksText(results: LocalActionResult[]): string {
    const card = results[results.length - 1];
    if (!card || 'error' in card) return card?.error ?? 'Books unavailable.';
    if (card.kind !== 'books-summary') return card.title;
    const data = card.data;
    return [
      `Books (${data.currency})`,
      `Cash: ${data.cash.formatted}`,
      `Receivables: ${data.receivable.formatted}`,
      `Payables: ${data.payable.formatted}`,
      `Revenue: ${data.revenue.formatted}`,
      `Expenses: ${data.expenses.formatted}`,
      `Net income: ${data.netIncome.formatted}`,
      `Trial balance: ${data.trialBalance.totals.balanced ? 'balanced' : 'out of balance'}`,
    ].join('\n');
  }
}
