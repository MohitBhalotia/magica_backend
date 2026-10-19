import { auth, runs, tasks } from "@trigger.dev/sdk";

import type { AgentRun } from "../../../prisma/generated/client";

/** How long a finished task's own hooks get to save before we treat its run as dead. */
const ENDED_GRACE_MS = 60_000;

/** The only place the API talks to Trigger.dev about agent turns. */
export const runTask = {
  /** Starts `agent-turn` for a run. Idempotent by run id, at most 3 turns per user at a time. */
  async start(run: AgentRun) {
    const handle = await tasks.trigger(
      "agent-turn",
      { runId: run.id },
      {
        idempotencyKey: run.id,
        concurrencyKey: run.userId,
        tags: [`chat_${run.chatId}`, `user_${run.userId}`],
      },
    );
    return handle.id;
  },

  /** Starts `chat-title` for a new chat. Idempotent by chat id, so a replayed send adds no run. */
  async title(chatId: string) {
    await tasks.trigger(
      "chat-title",
      { chatId },
      { idempotencyKey: `title:${chatId}`, tags: [`chat_${chatId}`] },
    );
  },

  /** Asks Trigger.dev to stop the task; its onCancel hook persists the partial answer. */
  cancel: (triggerRunId: string) => runs.cancel(triggerRunId),

  /**
   * Whether Trigger.dev finished the task over a minute ago, however it ended (crashes included).
   * The grace period matters: after Stop the run is marked finished while its onCancel hook is
   * still saving the partial answer, and settling it then would save an empty one instead.
   */
  hasEnded: async (triggerRunId: string) => {
    const run = await runs.retrieve(triggerRunId);
    const finishedAt = run.finishedAt?.getTime() ?? 0;
    return run.isCompleted && Date.now() - finishedAt > ENDED_GRACE_MS;
  },

  /** A browser token that can read only this one run, for an hour. */
  token: (triggerRunId: string) =>
    auth.createPublicToken({ scopes: { read: { runs: [triggerRunId] } }, expirationTime: "1h" }),
};
