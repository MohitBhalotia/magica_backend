import type { ContentBlock, ErrorCode } from "@mohitbhalotia/magica-contracts";

import { db as prisma, type DbClient } from "@/lib/db";

import {
  MessageRole,
  MessageStatus,
  RunStatus,
  type AgentRun,
  type Prisma,
} from "../../../prisma/generated/client";

const ACTIVE: RunStatus[] = [
  RunStatus.queued,
  RunStatus.thinking,
  RunStatus.working,
  RunStatus.waiting,
  RunStatus.stopping,
];

type NewRun = {
  chatId: string;
  userId: string;
  userMessageId: string;
  /** Unique per send attempt: the user message id, or `retry:<messageId>:<attempt>`. */
  dispatchKey: string;
  attempt: number;
  traceId: string;
};

/** How a turn ended, and the assistant message it leaves behind. */
export type RunEnd = {
  status: typeof RunStatus.completed | typeof RunStatus.failed | typeof RunStatus.cancelled;
  blocks: ContentBlock[];
  text: string;
  thinkingMs: number;
  routedModel?: string;
  tokenUsage?: Prisma.InputJsonObject;
  error?: { code: ErrorCode; message: string };
};

const MESSAGE_STATUS = {
  completed: MessageStatus.success,
  failed: MessageStatus.failed,
  cancelled: MessageStatus.cancelled,
} as const;

export const runRepository = {
  findByDispatchKey: (dispatchKey: string, db: DbClient = prisma) =>
    db.agentRun.findUnique({ where: { dispatchKey } }),

  /** Idempotent open: the run already created for this dispatch key, or a new one. */
  async findOrCreate(data: NewRun, db: DbClient = prisma) {
    return (
      (await runRepository.findByDispatchKey(data.dispatchKey, db)) ??
      runRepository.create(data, db)
    );
  },

  /** The chat's run in progress, if any (at most one: partial unique index). */
  findActive: (chatId: string, db: DbClient = prisma) =>
    db.agentRun.findFirst({ where: { chatId, status: { in: ACTIVE } } }),

  /** The chat's most recent run: only it may be retried, so a retry never answers out of order. */
  findLatest: (chatId: string, db: DbClient = prisma) =>
    db.agentRun.findFirst({ where: { chatId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),

  /** Ownership on every lookup (RULES §8): someone else's run is "not found". */
  findOwned: (id: string, userId: string, db: DbClient = prisma) =>
    db.agentRun.findFirst({ where: { id, userId } }),

  /**
   * The assistant placeholder message (`streaming`) and the queued run that will fill it. A second
   * active run on the chat violates `agent_runs_one_active_per_chat` (P2002) — the RUN_ACTIVE lock.
   */
  async create(data: NewRun, db: DbClient = prisma) {
    const assistant = await db.message.create({
      data: {
        chatId: data.chatId,
        userId: data.userId,
        role: MessageRole.assistant,
        status: MessageStatus.streaming,
      },
    });
    const dispatchPayload: Prisma.InputJsonObject = { chatId: data.chatId, userId: data.userId };
    return db.agentRun.create({
      data: { ...data, assistantMessageId: assistant.id, dispatchPayload },
    });
  },

  setTriggerRunId: (id: string, triggerRunId: string, db: DbClient = prisma) =>
    db.agentRun.update({ where: { id }, data: { triggerRunId } }),

  /** Only moves an active run (conditional update), so a finished run is never reopened. */
  setStatusIfActive: (id: string, status: RunStatus, db: DbClient = prisma) =>
    db.agentRun.updateMany({ where: { id, status: { in: ACTIVE } }, data: { status } }),

  /** Ends a run that never started (not dispatched): run and its placeholder become cancelled. */
  async cancelUndispatched(run: { id: string; assistantMessageId: string }, db: DbClient = prisma) {
    const now = new Date();
    await db.message.update({
      where: { id: run.assistantMessageId },
      data: { status: MessageStatus.cancelled, completedAt: now },
    });
    return db.agentRun.update({
      where: { id: run.id },
      data: { status: RunStatus.cancelled, finishedAt: now },
    });
  },

  /** Worker pickup: queued → thinking. Null when the run has already ended. */
  async begin(id: string, db: DbClient = prisma) {
    await db.agentRun.updateMany({
      where: { id, status: RunStatus.queued },
      data: { status: RunStatus.thinking, startedAt: new Date() },
    });
    const run = await db.agentRun.findUnique({
      where: { id },
      include: { chat: { select: { titleSource: true } } },
    });
    return run && isActive(run.status) ? run : null;
  },

  /** First text arrived: thinking → working. Never undoes a Stop. */
  markWorking: (id: string, db: DbClient = prisma) =>
    db.agentRun.updateMany({
      where: { id, status: RunStatus.thinking },
      data: { status: RunStatus.working },
    }),

  /** Ends an active run and fills its assistant message; false if the run had already ended. */
  async settle(run: AgentRun, end: RunEnd, db: DbClient = prisma) {
    const now = new Date();
    const error = { errorCode: end.error?.code, errorMessage: end.error?.message };
    const { count } = await db.agentRun.updateMany({
      where: { id: run.id, status: { in: ACTIVE } },
      data: {
        status: end.status,
        routedModel: end.routedModel,
        thinkingMs: end.thinkingMs,
        finishedAt: now,
        ...error,
      },
    });
    if (count === 0) return false;
    await db.message.update({
      where: { id: run.assistantMessageId },
      data: {
        status: MESSAGE_STATUS[end.status],
        contentBlocks: end.blocks,
        text: end.text,
        runId: run.id,
        tokenUsage: end.tokenUsage,
        routedModel: end.routedModel,
        completedAt: now,
        ...error,
      },
    });
    return true;
  },
};

export const isActive = (status: RunStatus) => ACTIVE.includes(status);
