import { logger, schemaTask, streams } from "@trigger.dev/sdk";
import type { UIMessageChunk } from "ai";
import { z } from "zod";

import { UI_STREAM } from "@mohitbhalotia/magica-contracts";

import { streamTurn, toStored, toTurnError, type TurnEnd } from "@/agent/turn";
import { AppError } from "@/lib/errors";
import { chatRepository } from "@/modules/chats/chat.repository";
import { runRepository } from "@/modules/runs/run.repository";
import { runService } from "@/modules/runs/run.service";
import { openRouterFree } from "@/providers/openrouter";

/** Messages the model sees; a rolling summary of older ones comes later (M3+). */
const HISTORY_LIMIT = 20;

const uiStream = streams.define<UIMessageChunk>({ id: UI_STREAM });

/** One durable agent turn: streams the answer to the browser, then settles it in Postgres. */
export const agentTurn = schemaTask({
  id: "agent-turn",
  schema: z.object({ runId: z.string() }),
  // Triggered with concurrencyKey = userId: at most 3 turns per user at a time.
  concurrency: { perKey: 3 },
  // The SDK retries the model call; re-running a half-streamed turn would duplicate text.
  retry: { maxAttempts: 1 },
  // Stop aborts `signal`; wait for run() to save the partial answer before the process ends.
  onCancel: async ({ runPromise }) => {
    await runPromise.catch(() => undefined);
  },
  run: async ({ runId }, { signal }) => {
    const run = await runRepository.begin(runId);
    if (!run) return { status: "skipped" };

    const history = await chatRepository.history(run.chatId, HISTORY_LIMIT);
    const turn = streamTurn({
      model: openRouterFree(),
      messages: history.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.text,
      })),
      signal,
    });
    // If Realtime itself breaks, the stream is never fully read: fail the turn instead of waiting.
    const end = await uiStream
      .pipe(turn.stream)
      .waitUntilComplete()
      .then(() => turn.ended)
      .catch((error: unknown): TurnEnd => ({ status: "failed", error }));

    const error = end.status === "failed" ? toTurnError(end.error) : undefined;
    if (error) logger.error("agent turn failed", { runId, code: error.code, err: end.error });
    const { usage } = end;
    await runService.settle(run, {
      status: end.status,
      ...toStored(end.message),
      routedModel: end.routedModel,
      tokenUsage: usage && {
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        totalTokens: usage.totalTokens ?? null,
      },
      error: error && { code: error.code, message: error.message },
    });
    // A failed turn fails the Trigger.dev run too, with the same user-safe message.
    if (error) throw new AppError(error.code, error.message);
    return { status: end.status };
  },
});
