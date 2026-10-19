import type { RunHandle, SendResponse } from "@mohitbhalotia/magica-contracts";

import { db, type DbClient } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { chatRepository } from "@/modules/chats/chat.repository";
import { creditRepository } from "@/modules/credits/credit.repository";
import { creditService } from "@/modules/credits/credit.service";
import { isActive, runRepository, type RunEnd } from "@/modules/runs/run.repository";
import { runTask } from "@/modules/runs/run.task";
import { toWaitpoint, waitpointRepository } from "@/modules/waitpoints/waitpoint.repository";

import { Prisma, RunStatus, type AgentRun } from "../../../prisma/generated/client";

type Ctx = { traceId: string; logger: Logger };

const notFound = () => new AppError("NOT_FOUND", "Run not found.");

async function ownedRun(runId: string, userId: string) {
  const run = await runRepository.findOwned(runId, userId);
  if (!run) throw notFound();
  return run;
}

/** What the browser needs to follow the run live, and the question it's waiting on, if any. */
async function toHandle(run: AgentRun): Promise<RunHandle> {
  const [publicAccessToken, waitpoint] = await Promise.all([
    run.triggerRunId ? runTask.token(run.triggerRunId) : null,
    run.status === RunStatus.waiting ? waitpointRepository.findPending(run.id) : null,
  ]);
  return {
    runId: run.id,
    status: run.status,
    triggerRunId: run.triggerRunId,
    publicAccessToken,
    waitpoint: waitpoint && toWaitpoint(waitpoint),
  };
}

/** Hands a queued run to Trigger.dev. On failure the run stays queued; a replayed send retries. */
async function dispatch(run: AgentRun, { logger }: Ctx) {
  if (run.triggerRunId || !isActive(run.status)) return run;
  try {
    return await runRepository.setTriggerRunId(run.id, await runTask.start(run));
  } catch (err) {
    logger.error({ err, runId: run.id }, "agent-turn dispatch failed; run left queued");
    return run;
  }
}

/** A new run holds the admission reserve in the same transaction, so a 402 saves nothing. */
async function openRun(data: Parameters<typeof runRepository.findOrCreate>[0], tx: DbClient) {
  const run = await runRepository.findOrCreate(data, tx);
  await creditService.admit(run, tx);
  return run;
}

export const runService = {
  /** Inside the send transaction: the run answering this user message (reused on a replay). */
  open: (
    data: { chatId: string; userId: string; userMessageId: string; traceId: string },
    tx: DbClient,
  ) => openRun({ ...data, dispatchKey: data.userMessageId, attempt: 1 }, tx),

  /**
   * Runs a send. If the chat already has an active run, the partial unique index rejects the
   * insert (P2002) and the caller gets 409 RUN_ACTIVE instead.
   */
  async withRunLock<T>(chatId: string, send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (err) {
      const active =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
          ? await runRepository.findActive(chatId)
          : null;
      if (!active) throw err;
      throw new AppError("RUN_ACTIVE", "A reply is already in progress in this chat.", {
        activeRunId: active.id,
      });
    }
  },

  /** After commit: dispatch the run and answer the send. */
  async respond(run: AgentRun, ctx: Ctx): Promise<SendResponse> {
    const dispatched = await dispatch(run, ctx);
    return {
      chatId: dispatched.chatId,
      userMessageId: dispatched.userMessageId,
      assistantMessageId: dispatched.assistantMessageId,
      run: await toHandle(dispatched),
    };
  },

  /** The chat's run in progress with a fresh token, so a reload can resume the live stream. */
  async activeHandle(chatId: string) {
    const run = await runRepository.findActive(chatId);
    if (!run) return null;
    // Stopped, but its worker died before saving (a crash): end it here so the chat unlocks.
    const ended =
      run.status === RunStatus.stopping &&
      run.triggerRunId !== null &&
      (await runTask.hasEnded(run.triggerRunId).catch(() => false));
    if (!ended) return toHandle(run);
    await runService.settle(run, {
      status: RunStatus.cancelled,
      blocks: [],
      text: "",
      metadata: {},
    });
    return null;
  },

  /** Stop. Idempotent: a finished run comes back as is; one never dispatched is cancelled here. */
  async cancel(runId: string, userId: string, { logger }: Ctx) {
    const run = await ownedRun(runId, userId);
    if (!isActive(run.status)) return toHandle(run);
    if (!run.triggerRunId) {
      const cancelled = await db.$transaction(async (tx) => {
        await creditService.endAdmission(run.id, tx);
        return runRepository.cancelUndispatched(run, tx);
      });
      return toHandle(cancelled);
    }

    await runRepository.setStatusIfActive(run.id, RunStatus.stopping);
    try {
      await runTask.cancel(run.triggerRunId);
    } catch (err) {
      logger.warn({ err, runId }, "runs.cancel failed (the run may have just finished)");
    }
    return toHandle({ ...run, status: RunStatus.stopping });
  },

  /** Retry: a new run on the same user message, for the chat's latest reply if it failed or stopped. */
  async retry(runId: string, userId: string, ctx: Ctx) {
    const run = await ownedRun(runId, userId);
    const isLatest = (await runRepository.findLatest(run.chatId))?.id === run.id;
    const ended = run.status === RunStatus.failed || run.status === RunStatus.cancelled;
    if (!isLatest || !ended)
      throw new AppError(
        "VALIDATION_FAILED",
        "Only the latest failed or stopped reply can be retried.",
      );

    const attempt = run.attempt + 1;
    const next = await runService.withRunLock(run.chatId, () =>
      db.$transaction((tx) =>
        openRun(
          {
            chatId: run.chatId,
            userId: run.userId,
            userMessageId: run.userMessageId,
            dispatchKey: `retry:${run.userMessageId}:${String(attempt)}`,
            attempt,
            traceId: ctx.traceId,
          },
          tx,
        ),
      ),
    );
    return runService.respond(next, ctx);
  },

  /**
   * Worker: in one transaction, the turn's end, its assistant message (with what its tools were
   * charged), the chat's new activity and the release of the admission reserve.
   */
  settle: (run: AgentRun, end: RunEnd) =>
    db.$transaction(async (tx) => {
      const charged = await creditRepository.chargedForRun(run.id, tx);
      const metadata = { ...end.metadata, creditsUsedMicro: Number(charged) };
      const ended = await runRepository.settle(run, { ...end, metadata }, tx);
      if (ended) {
        await chatRepository.touch(run.chatId, tx);
        await creditService.endAdmission(run.id, tx);
      }
      return ended;
    }),
};
