import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RequestContext } from '@mastra/core/request-context';
import { randomUUID } from 'node:crypto';
import {
  ChatMessageView,
  ChatRequestContext,
  ChatStreamEvent,
  ChatThreadView,
} from './chat.types';
import { KeizMastra, MASTRA } from './mastra.provider';
import { mapChunk } from './stream-mapper';

export interface StreamInput {
  orgId: string;
  userId: string;
  accountId: string;
  message: string;
  threadId?: string;
  abortSignal?: AbortSignal;
}

interface LocalResult {
  events: ChatStreamEvent[];
  text: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(@Inject(MASTRA) private readonly keiz: KeizMastra) {
    this.logger.log(`Chat provider: ${keiz.provider} (${keiz.modelId})`);
  }

  get provider(): 'mastra' | 'local' {
    return this.keiz.provider;
  }

  private resourceId(orgId: string, userId: string): string {
    return `org:${orgId}:user:${userId}`;
  }

  private context(input: StreamInput): RequestContext<ChatRequestContext> {
    const ctx = new RequestContext<ChatRequestContext>();
    ctx.set('orgId', input.orgId);
    ctx.set('userId', input.userId);
    ctx.set('accountId', input.accountId);
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

    try {
      const stream = await this.keiz.agent.stream([{ role: 'user', content: input.message }], {
        memory: { thread: threadId, resource: resourceId },
        requestContext: this.context(input),
        abortSignal: input.abortSignal,
      });

      for await (const chunk of stream.fullStream) {
        const event = mapChunk(chunk);
        if (event) yield event;
      }

      const usage = await stream.usage.catch(() => undefined);
      yield { type: 'done', threadId, usage };
    } catch (error) {
      if (input.abortSignal?.aborted) return;
      this.logger.warn(`Mastra stream failed: ${(error as Error).message}`);
      yield { type: 'error', message: this.friendlyError(error) };
    }
  }

  private friendlyError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'The assistant failed';
    if (/api key|401|unauthorized/i.test(message)) {
      return 'NEAR AI rejected the request. Check NEARAI_API_KEY, or set CHAT_PROVIDER=local for the offline demo.';
    }
    return message;
  }

  /**
   * Offline path. It calls the exact same Mastra tools, so org scoping and
   * business rules cannot drift between the two modes.
   */
  private async *localStream(
    input: StreamInput,
    threadId: string,
    resourceId: string,
  ): AsyncGenerator<ChatStreamEvent> {
    const requestContext = this.context(input);
    const result = await this.localReply(input.message, requestContext);
    await this.persistLocalTurn(threadId, resourceId, input.message, result);
    for (const event of result.events) yield event;
    for (const chunk of result.text.match(/\s+|\S+/g) ?? []) {
      yield { type: 'text', delta: chunk };
    }
    yield { type: 'done', threadId };
  }

  /** The Mastra agent persists automatically; the offline path must do it explicitly. */
  private async persistLocalTurn(
    threadId: string,
    resourceId: string,
    userText: string,
    result: LocalResult,
  ) {
    const calls = result.events.filter(
      (event): event is Extract<ChatStreamEvent, { type: 'tool'; phase: 'call' }> =>
        event.type === 'tool' && event.phase === 'call',
    );
    const results = result.events.filter(
      (event): event is Extract<ChatStreamEvent, { type: 'tool'; phase: 'result' }> =>
        event.type === 'tool' && event.phase === 'result',
    );
    const parts: Array<Record<string, unknown>> = [
      { type: 'text', text: result.text },
      ...calls.map((call, index) => ({
        type: 'tool-invocation',
        toolInvocation: {
          state: 'result',
          toolCallId: `local-call-${index}`,
          toolName: call.name,
          args: call.args,
          result: results[index]?.result ?? null,
        },
      })),
    ];
    const now = Date.now();
    await this.keiz.memory.saveMessages({
      messages: [
        {
          id: randomUUID(),
          threadId,
          resourceId,
          role: 'user',
          createdAt: new Date(now),
          content: { format: 2, parts: [{ type: 'text', text: userText }] },
        },
        {
          id: randomUUID(),
          threadId,
          resourceId,
          role: 'assistant',
          createdAt: new Date(now + 1),
          content: { format: 2, parts },
        },
      ] as never,
    });
  }

  private async localReply(
    message: string,
    requestContext: RequestContext<ChatRequestContext>,
  ): Promise<LocalResult> {
    const tools = this.keiz.tools;
    const events: ChatStreamEvent[] = [];
    const call = async <T>(
      name: string,
      args: Record<string, unknown>,
      run: () => Promise<T>,
    ): Promise<T> => {
      events.push({ type: 'tool', phase: 'call', name, args });
      const value = await run();
      events.push({ type: 'tool', phase: 'result', name, result: value });
      return value;
    };
    const context = { requestContext } as never;

    const lower = message.toLowerCase();
    const invoiceNumber = message.match(/INV[-_ ]?\d+/i)?.[0]?.replace(/[ _]/g, '-').toUpperCase();

    if ((/^pay\b|pay invoice|propose/.test(lower) || lower.includes('pay inv')) && invoiceNumber) {
      const result = (await call('proposePayment', { invoiceNumber }, () =>
        tools.proposePayment.execute!({ invoiceNumber, reason: 'Requested from chat' }, context),
      )) as { error?: string; status?: string; amountUsd?: string };
      if (result?.error) return { events, text: result.error };
      return {
        events,
        text: `Proposed ${invoiceNumber} for $${result.amountUsd}.\nStatus: ${result.status}.\nOpen Agent to approve or execute - chat cannot move funds.`,
      };
    }

    if (invoiceNumber) {
      const invoice = (await call('getInvoice', { number: invoiceNumber }, () =>
        tools.getInvoice.execute!({ number: invoiceNumber }, context),
      )) as Record<string, unknown> | null;
      if (!invoice || invoice.error) {
        return { events, text: `I could not find ${invoiceNumber}.` };
      }
      const due = String(invoice.dueDate ?? '').slice(0, 10);
      return {
        events,
        text: [
          `${invoice.number}`,
          `Status: ${invoice.status}`,
          `Total: ${invoice.currency} ${invoice.total}`,
          `Due: ${due}`,
        ].join('\n'),
      };
    }

    if (lower.includes('spend') || lower.includes('summary') || lower.includes('burn')) {
      const summary = (await call('spendSummary', {}, () =>
        tools.spendSummary.execute!({}, context),
      )) as {
        byStatus: Array<{ status: string; count: number; total: string }>;
        vendorCount: number;
      };
      const lines = summary.byStatus
        .map((row) => `${row.status}: ${row.count} invoice(s), $${row.total}`)
        .join('\n');
      return {
        events,
        text: `Spend by status\n${lines || 'No invoices yet.'}\n\nVendors: ${summary.vendorCount}`,
      };
    }

    if (lower.includes('vendor')) {
      const vendors = (await call('listVendors', {}, () =>
        tools.listVendors.execute!({}, context),
      )) as Array<Record<string, unknown>>;
      if (!vendors.length) return { events, text: 'No vendors yet.' };
      return {
        events,
        text: vendors
          .map((vendor) => `${vendor.name} - ${vendor.payoutChain} - ${vendor.payoutAddress}`)
          .join('\n'),
      };
    }

    if (lower.includes('pending') || lower.includes('approve') || lower.includes('waiting')) {
      const rows = (await call('listInvoices', { status: 'SUBMITTED' }, () =>
        tools.listInvoices.execute!({ status: 'SUBMITTED' }, context),
      )) as Array<Record<string, unknown>>;
      if (!rows.length) return { events, text: 'Nothing is waiting for approval.' };
      return {
        events,
        text: rows.map((row) => `${row.number} - ${row.currency} ${row.total}`).join('\n'),
      };
    }

    const invoices = (await call('listInvoices', { limit: 5 }, () =>
      tools.listInvoices.execute!({ limit: 5 }, context),
    )) as Array<Record<string, unknown>>;
    return {
      events,
      text: [
        'I can help with invoices, vendors, spend and agent payment proposals.',
        '',
        invoices.length
          ? `Latest invoices:\n${invoices.map((row) => `${row.number} (${row.status})`).join('\n')}`
          : 'No invoices yet - create one or load demo data.',
        '',
        'Try: "show pending invoices", "spend summary", or "pay INV-1042".',
      ].join('\n'),
    };
  }
}
