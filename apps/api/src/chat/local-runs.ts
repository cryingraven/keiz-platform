import type { ChatCard, ChatPlan } from '@keiz/shared';

export type LocalActionResult = ChatCard | { error: string };

export interface LocalAction {
  name: string;
  args: Record<string, unknown>;
  run: () => Promise<LocalActionResult>;
}

export interface LocalRun {
  runId: string;
  orgId: string;
  userId: string;
  threadId: string;
  userText: string;
  plan: ChatPlan;
  actions: LocalAction[];
  results: LocalActionResult[];
  index: number;
  render: (results: LocalActionResult[]) => string;
  createdAt: number;
}

const TTL_MS = 15 * 60 * 1000;

/** In-memory suspension state for the deterministic offline provider. */
export class LocalRunStore {
  private readonly runs = new Map<string, LocalRun>();

  create(run: Omit<LocalRun, 'createdAt'>): LocalRun {
    this.prune();
    const stored: LocalRun = { ...run, createdAt: Date.now() };
    this.runs.set(run.runId, stored);
    return stored;
  }

  get(runId: string): LocalRun | undefined {
    this.prune();
    return this.runs.get(runId);
  }

  delete(runId: string): void {
    this.runs.delete(runId);
  }

  listForThread(orgId: string, userId: string, threadId: string): LocalRun[] {
    this.prune();
    return [...this.runs.values()].filter(
      (run) => run.orgId === orgId && run.userId === userId && run.threadId === threadId,
    );
  }

  private prune(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [runId, run] of this.runs) {
      if (run.createdAt < cutoff) this.runs.delete(runId);
    }
  }
}
