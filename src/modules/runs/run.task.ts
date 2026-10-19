import { auth, runs, tasks } from "@trigger.dev/sdk";

import type { AgentRun } from "../../../prisma/generated/client";

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

  /** A browser token that can read only this one run, for an hour. */
  token: (triggerRunId: string) =>
    auth.createPublicToken({ scopes: { read: { runs: [triggerRunId] } }, expirationTime: "1h" }),
};
