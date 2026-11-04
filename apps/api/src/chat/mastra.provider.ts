import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { Memory } from '@mastra/memory';
import { MongoDBStore } from '@mastra/mongodb';
import { ConfigService } from '@nestjs/config';
import { AccountingService } from '../accounting/accounting.service';
import { AgentService } from '../agent/agent.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { VendorsService } from '../vendors/vendors.service';
import { createChatTools, ChatTools } from './tools';

export const MASTRA = Symbol('KEIZ_MASTRA');

export type ChatProviderKind = 'mastra' | 'local';

export interface KeizMastra {
  mastra: Mastra;
  agent: Agent;
  memory: Memory;
  storage: MongoDBStore;
  tools: ChatTools;
  provider: ChatProviderKind;
  modelId: string;
}

export const SYSTEM_PROMPT = `You are KEIZ, a finance operations assistant for a B2B payments workspace on NEAR.

Rules:
- Always call a tool before stating a number, invoice, vendor or status. Never invent data.
- You cannot move funds. propose-payment only creates a proposal that a human must approve and execute.
- Be concise. Use short lines and plain text. No markdown tables.
- Amounts from tools are already formatted in major units. Do not re-scale them.
- If a request is ambiguous, ask one clarifying question.
- Only discuss the current workspace. Never mention another organization.`;

/** Extract the database name from a Mongo URI when MONGODB_DB_NAME is unset. */
export function databaseName(uri: string, explicit?: string): string {
  if (explicit) return explicit;
  const withoutQuery = uri.split('?')[0];
  const name = withoutQuery.split('/').filter(Boolean).pop();
  return name && name !== 'mongodb:' ? name : 'keiz';
}

function normalizeModelId(raw: string): string {
  return raw.startsWith('nearai/') ? raw : `nearai/${raw}`;
}

export interface MastraDeps {
  config: ConfigService;
  invoices: InvoicesService;
  vendors: VendorsService;
  payments: PaymentsService;
  agent: AgentService;
  accounting: AccountingService;
}

export function createKeizMastra(deps: MastraDeps): KeizMastra {
  const { config } = deps;
  const uri = config.get<string>('MONGODB_URI') ?? 'mongodb://127.0.0.1:27017/keiz';
  const dbName = databaseName(uri, config.get<string>('MONGODB_DB_NAME'));

  const storage = new MongoDBStore({
    id: 'keiz-mastra',
    uri,
    dbName,
  });

  const apiKey = config.get<string>('NEARAI_API_KEY');
  const modelId = normalizeModelId(
    config.get<string>('NEAR_AI_MODEL') ?? 'nearai/deepseek/deepseek-v4.1-flash-1017',
  );
  const baseUrl = config.get<string>('NEAR_AI_BASE_URL') ?? 'https://cloud-api.near.ai/v1';

  const memory = new Memory({
    storage,
    vector: false, // standalone Mongo has no Atlas Search; message history only
    options: {
      lastMessages: 20,
      semanticRecall: false,
      generateTitle: false, // titles come from the first message; avoids an extra model call
    },
  });

  const tools = createChatTools({
    invoices: deps.invoices,
    vendors: deps.vendors,
    payments: deps.payments,
    agent: deps.agent,
    accounting: deps.accounting,
  });

  const agent = new Agent({
    id: 'keiz-agent',
    name: 'KEIZ assistant',
    instructions: SYSTEM_PROMPT,
    model: {
      id: modelId as `${string}/${string}`,
      url: baseUrl,
      ...(apiKey ? { apiKey } : {}),
    },
    tools,
    memory,
  });

  const mastra = new Mastra({
    agents: { keizAgent: agent },
    storage,
  });

  const requested = config.get<string>('CHAT_PROVIDER');
  // Mastra is the real path, but without a key it can only fail at request time.
  // Fall back to the deterministic local provider so demos and tests stay offline.
  const provider: ChatProviderKind = requested === 'local' || !apiKey ? 'local' : 'mastra';

  return { mastra, agent, memory, storage, tools, provider, modelId };
}
