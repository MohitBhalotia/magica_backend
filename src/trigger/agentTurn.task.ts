import { logger, schemaTask, streams } from "@trigger.dev/sdk";
import type { UIMessageChunk } from "ai";
import { z } from "zod";

import { UI_STREAM } from "@mohitbhalotia/magica-contracts";

import { skillCatalog } from "@/agent/skills/registry";
import { AGENT_TOOLS } from "@/agent/tools";
import { buildTools } from "@/agent/tools/define";
import { skillIndex } from "@/agent/tools/skills";
import { streamTurn, toStored, toTurnError, type TurnEnd } from "@/agent/turn";
import { AppError } from "@/lib/errors";
import { chatRepository } from "@/modules/chats/chat.repository";
import { directToolOf, runRepository } from "@/modules/runs/run.repository";
import { runService } from "@/modules/runs/run.service";
import { runEvent, webhookService } from "@/modules/webhooks/webhook.service";
import { directTool } from "@/providers/directTool";
import { openRouterFree } from "@/providers/openrouter";
import { signedUrl } from "@/providers/r2";

/** Messages the model sees; a rolling summary of older ones comes later (M3+). */
const HISTORY_LIMIT = 20;

const uiStream = streams.define<UIMessageChunk>({ id: UI_STREAM });

/**
 * The files a user sent, in their order, with fresh signed links the agent can pass to the media
 * tools (crop `image_url`, edit `uploadedImages`, merge `video_urls`). Empty when there are none.
 */
async function attachedFiles(files: { name: string; kind: string; r2Key: string | null }[]) {
  const lines = await Promise.all(
    files.flatMap((file, i) =>
      file.r2Key
        ? [
            signedUrl(file.r2Key, file.name).then(
              (url) => `${String(i + 1)}. ${file.name} (${file.kind}): ${url}`,
            ),
          ]
        : [],
    ),
  );
  return lines.length ? `\n\nAttached files, in order:\n${lines.join("\n")}` : "";
}

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
    // Its id is fixed per run, so a re-entered turn doesn't announce itself twice.
    await webhookService.dispatch(
      await webhookService.emit(run.userId, runEvent(run, "agent.started", { status: run.status })),
    );

    const history = await chatRepository.history(run.chatId, HISTORY_LIMIT);
    const messages = await Promise.all(
      history.map(async (m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.text + (await attachedFiles(m.attachments)),
      })),
    );
    // `POST /tools/{tool}/run`: just that tool, called with the caller's input, and no LLM.
    const direct = directToolOf(run);
    const tools = buildTools(
      direct ? AGENT_TOOLS.filter((t) => t.name === direct.tool) : AGENT_TOOLS,
      {
        runId: run.id,
        chatId: run.chatId,
        userId: run.userId,
        messageId: run.assistantMessageId,
        signal,
      },
    );
    // The model sees only skill names and descriptions; load_skill fetches a body (PRD §5.7).
    const skills = skillCatalog(await skillIndex());
    const instructions = `Skills (call load_skill before the task a skill covers):\n${skills}`;
    const model = direct ? directTool(direct.tool, direct.input) : openRouterFree();

    const turn = streamTurn({ model, messages, tools, instructions, signal });
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
