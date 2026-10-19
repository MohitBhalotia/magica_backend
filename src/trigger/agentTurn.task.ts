import { logger, metadata, schemaTask, streams, wait } from "@trigger.dev/sdk";
import { z } from "zod";

import { REASONING_STREAM, TEXT_STREAM } from "@mohitbhalotia/magica-contracts";

import { runTurn, toBlocks, type Draft } from "@/agent/turn";
import { AppError } from "@/lib/errors";
import { chatRepository } from "@/modules/chats/chat.repository";
import type { RunEnd } from "@/modules/runs/run.repository";
import { runRepository } from "@/modules/runs/run.repository";
import { runService } from "@/modules/runs/run.service";
import { openRouterFree } from "@/providers/openrouter";
import { chatTitle } from "@/trigger/chatTitle.task";

import { RunStatus, TitleSource } from "../../prisma/generated/client";

/** Messages the model sees; a rolling summary of older ones comes later (M3+). */
const HISTORY_LIMIT = 20;

const textStream = streams.define<string>({ id: TEXT_STREAM });
const reasoningStream = streams.define<string>({ id: REASONING_STREAM });

/** A Realtime stream fed one delta at a time; pipe() sends them in batches, not a request each. */
function liveStream(stream: typeof textStream) {
  const { readable, writable } = new TransformStream<string, string>();
  const piped = stream.pipe(readable);
  const writer = writable.getWriter();
  return {
    write: (delta: string) => writer.write(delta),
    async close() {
      await writer.close();
      await piped.waitUntilComplete();
    },
  };
}

/** One durable agent turn: streams the answer to the browser, then settles it in Postgres. */
export const agentTurn = schemaTask({
  id: "agent-turn",
  schema: z.object({ runId: z.string() }),
  // Triggered with concurrencyKey = userId: at most 3 turns per user at a time.
  concurrency: { perKey: 3 },
  // The model call retries inside the turn; re-running a half-streamed turn would duplicate text.
  retry: { maxAttempts: 1 },
  // Stop aborts `signal`; wait for run() to save the partial answer before the process ends.
  onCancel: async ({ runPromise }) => {
    await runPromise.catch(() => undefined);
  },
  run: async ({ runId }, { signal }) => {
    const run = await runRepository.begin(runId);
    if (!run) return { status: "skipped" };
    metadata.set("status", RunStatus.thinking);

    const draft: Draft = { text: "", reasoning: "" };
    const text = liveStream(textStream);
    const reasoning = liveStream(reasoningStream);
    let working = false;

    const end: Omit<RunEnd, "blocks" | "text" | "thinkingMs"> = await runTurn({
      model: openRouterFree(),
      messages: (await chatRepository.history(run.chatId, HISTORY_LIMIT)).map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.text,
      })),
      draft,
      signal,
      onReasoning: (delta) => reasoning.write(delta),
      onText: async (delta) => {
        if (!working) {
          working = true;
          await runRepository.markWorking(run.id);
          metadata.set("status", RunStatus.working);
        }
        await text.write(delta);
      },
      sleep: (seconds) => wait.for({ seconds }),
    })
      .then(({ routedModel, usage }) => ({
        status: RunStatus.completed,
        routedModel,
        tokenUsage: usage && {
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          totalTokens: usage.totalTokens ?? null,
        },
      }))
      .catch((err: unknown) => {
        if (signal.aborted) return { status: RunStatus.cancelled };
        logger.error("agent turn failed", { err, runId });
        const { code, message } =
          err instanceof AppError
            ? err
            : new AppError("INTERNAL", "Something went wrong. Please try again.");
        return { status: RunStatus.failed, error: { code, message } };
      })
      .finally(() => Promise.all([text.close(), reasoning.close()]));

    await runService.settle(run, {
      ...end,
      blocks: toBlocks(draft),
      text: draft.text,
      thinkingMs: draft.reasoningMs ?? 0,
    });
    // A failed turn fails the Trigger.dev run too, with the same user-safe message.
    if (end.error) throw new AppError(end.error.code, end.error.message);
    if (end.status === RunStatus.completed && run.chat.titleSource === TitleSource.prompt)
      await chatTitle.trigger({ chatId: run.chatId }).catch((err: unknown) => {
        logger.warn("chat-title trigger failed; the prompt title stays", { err, runId });
      });
    return { status: end.status };
  },
});
