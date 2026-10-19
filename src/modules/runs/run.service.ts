import { auth, runs, tasks } from "@trigger.dev/sdk";

import type { RunHandle } from "@mohitbhalotia/magica-contracts";

import { db, type DbClient } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { isActive, runRepository } from "@/modules/runs/run.repository";

import { Prisma, RunStatus, type AgentRun } from "../../../prisma/generated/client";

const AGENT_TURN = "agent-turn";
const notFound = () => new AppError("NOT_FOUND", "Run not found.");
type Ctx = { traceId: string; logger: Logger };

/** What the browser needs to follow the run: a token that can read only this one Trigger.dev run. */
async function toHandle(run: AgentRun): Promise<RunHandle> {
  const publicAccessToken = run.triggerRunId
    ? await auth.createPublicToken({
        scopes: { read: { runs: [run.triggerRunId] } },
        expirationTime: "1h",
      })
    : null;
  return { runId: run.id, status: run.status, triggerRunId: run.triggerRunId, publicAccessToken };
}

/**
 * A unique violation on `agent_runs` while opening a run means the chat already has an active run
 * (partial unique index): surface it as 409 RUN_ACTIVE. Anything else passes through unchanged.
 */
async function toRunActive(err: unknown, chatId: string): Promise<unknown> {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return err;
  const active = await runRepository.findActive(chatId);
  return active
    ? new AppError("RUN_ACTIVE", "A reply is already in progress in this chat.", {
        activeRunId: active.id,
      })
    : err;
}

export const runService = {
  /**
   * Inside the caller's transaction: the run answering `userMessageId`. A replayed send finds the
   * existing run (dispatchKey = user message id) instead of creating a second one.
   */
  async open(
    data: { chatId: string; userId: string; userMessageId: string; traceId: string },
    tx: DbClient,
  ) {
    return (
      (await runRepository.findByDispatchKey(data.userMessageId, tx)) ??
      runRepository.create({ ...data, dispatchKey: data.userMessageId, attempt: 1 }, tx)
    );
  },

  /** Wraps a send transaction so the one-active-run lock becomes RUN_ACTIVE. */
  async withRunLock<T>(chatId: string, send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (err) {
      throw await toRunActive(err, chatId);
    }
  },

  /**
   * After commit: hand the run to Trigger.dev (idempotent by run id) and return the browser's handle.
   * If the trigger call fails the run stays queued; replaying the send dispatches it again.
   */
  async dispatch(run: AgentRun, { logger }: Ctx): Promise<RunHandle> {
    if (!run.triggerRunId && isActive(run.status)) {
      try {
        const handle = await tasks.trigger(
          AGENT_TURN,
          { runId: run.id },
          {
            idempotencyKey: run.id,
            concurrencyKey: run.userId,
            tags: [`chat_${run.chatId}`, `user_${run.userId}`],
          },
        );
        run = await runRepository.setTriggerRunId(run.id, handle.id);
      } catch (err) {
        logger.error({ err, runId: run.id }, "agent-turn dispatch failed; run left queued");
      }
    }
    return toHandle(run);
  },

  /** The chat's run in progress with a fresh token, so a reload can resume the live stream. */
  async activeHandle(chatId: string) {
    const run = await runRepository.findActive(chatId);
    return run ? toHandle(run) : null;
  },

  /** Stop. Idempotent: a finished run is returned as is; an undispatched one is cancelled here. */
  async cancel(runId: string, userId: string, { logger }: Ctx) {
    const run = await runRepository.findOwned(runId, userId);
    if (!run) throw notFound();
    if (!isActive(run.status)) return toHandle(run);
    if (!run.triggerRunId) return toHandle(await runRepository.cancelUndispatched(run));
    await runRepository.setStatusIfActive(run.id, RunStatus.stopping);
    // The task's onCancel persists the partial answer and marks the run cancelled.
    try {
      await runs.cancel(run.triggerRunId);
    } catch (err) {
      logger.warn({ err, runId }, "runs.cancel failed (run may have just finished)");
    }
    return toHandle({ ...run, status: RunStatus.stopping });
  },

  /** A new run on the same user message, for the chat's latest turn when it failed or was stopped. */
  async retry(runId: string, userId: string, ctx: Ctx) {
    const run = await runRepository.findOwned(runId, userId);
    if (!run) throw notFound();
    const latest = await runRepository.findLatest(run.chatId);
    if (
      latest?.id !== run.id ||
      (run.status !== RunStatus.failed && run.status !== RunStatus.cancelled)
    )
      throw new AppError(
        "VALIDATION_FAILED",
        "Only the latest failed or stopped reply can be retried.",
      );

    const attempt = run.attempt + 1;
    const dispatchKey = `retry:${run.userMessageId}:${String(attempt)}`;
    const next = await runService.withRunLock(run.chatId, () =>
      db.$transaction(
        async (tx) =>
          (await runRepository.findByDispatchKey(dispatchKey, tx)) ??
          runRepository.create(
            {
              chatId: run.chatId,
              userId: run.userId,
              userMessageId: run.userMessageId,
              dispatchKey,
              attempt,
              traceId: ctx.traceId,
            },
            tx,
          ),
      ),
    );
    return {
      chatId: next.chatId,
      userMessageId: next.userMessageId,
      assistantMessageId: next.assistantMessageId,
      run: await runService.dispatch(next, ctx),
    };
  },
};
