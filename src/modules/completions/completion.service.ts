import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { UIMessageChunk } from "ai";

import {
  ErrorCodeSchema,
  ModelIdSchema,
  type ChatCompletion,
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type SendResponse,
} from "@mohitbhalotia/magica-contracts";

import { AppError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { chatRepository } from "@/modules/chats/chat.repository";
import { chatService } from "@/modules/chats/chat.service";
import { runService } from "@/modules/runs/run.service";
import { runTask } from "@/modules/runs/run.task";

type Ctx = { traceId: string; logger: Logger };

const MODEL = ModelIdSchema.value;
/** `stream: false` waits this long for the answer, then hands back the run to poll instead. */
const WAIT_MS = 60_000;
const POLL_MS = 1_000;
/** A stream ends a little before the function's 300s limit, saying the run is still going. */
const STREAM_MS = 280_000;
/** Statuses that won't end on their own soon: a pending approval, or the end itself. */
const SETTLED = new Set(["waiting", "completed", "failed", "cancelled"]);

const encoder = new TextEncoder();
const sse = (data: unknown) =>
  encoder.encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);

/** OpenAI's usage fields from the token counts saved on the reply. */
function usageOf(saved: unknown): ChatCompletion["usage"] {
  const u = saved as { inputTokens?: number | null; outputTokens?: number | null } | null;
  if (u?.inputTokens == null || u.outputTokens == null) return null;
  return {
    prompt_tokens: u.inputTokens,
    completion_tokens: u.outputTokens,
    total_tokens: u.inputTokens + u.outputTokens,
  };
}

export const completionService = {
  /** Starts the turn: the last user message, in `chat_id` or a new chat. */
  start(
    userId: string,
    body: ChatCompletionRequest,
    idempotencyKey: string | undefined,
    ctx: Ctx,
  ): Promise<SendResponse> {
    if (body.model !== MODEL)
      throw new AppError("UNSUPPORTED_MODEL", `Only ${MODEL} is available.`, {
        model: body.model,
      });
    const text = body.messages.findLast((m) => m.role === "user")?.content.trim();
    if (!text) throw new AppError("VALIDATION_FAILED", "`messages` needs a user message.");
    const clientMessageId = idempotencyKey ?? randomUUID();
    return body.chat_id
      ? chatService.send(body.chat_id, userId, clientMessageId, text, ctx)
      : chatService.create(userId, clientMessageId, text, ctx);
  },

  /**
   * `stream: false`: the saved answer once the run ends, or null if it's still going after 60s
   * (or waiting on an approval), so the caller polls the run. A failed turn is its own error.
   */
  async finish(sent: SendResponse, userId: string): Promise<ChatCompletion | null> {
    const deadline = Date.now() + WAIT_MS;
    let status = sent.run.status;
    while (!SETTLED.has(status)) {
      if (Date.now() >= deadline) return null;
      await sleep(POLL_MS);
      ({ status } = await runService.get(sent.run.runId, userId));
    }
    if (status === "waiting") return null;

    const reply = await chatRepository.findMessage(sent.assistantMessageId, userId);
    if (status === "failed")
      throw new AppError(
        ErrorCodeSchema.catch("INTERNAL").parse(reply?.errorCode),
        reply?.errorMessage ?? "The reply failed. Try again.",
        { chatId: sent.chatId, runId: sent.run.runId },
      );
    return {
      id: `chatcmpl-${sent.run.runId}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      // A stopped reply keeps what it wrote, as the app does.
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: reply?.text ?? "" },
          finish_reason: "stop",
        },
      ],
      usage: usageOf(reply?.tokenUsage),
      chat_id: sent.chatId,
      run_id: sent.run.runId,
    };
  },

  /**
   * `stream: true`: the run's own stream as OpenAI chunks (text deltas; tool steps in `magica`),
   * ended by `[DONE]`. If the run outlives the stream, the last chunk says so and the caller polls.
   */
  stream(sent: SendResponse, triggerRunId: string, request: AbortSignal) {
    const ids = { chat_id: sent.chatId, run_id: sent.run.runId };
    const chunk = (
      delta: ChatCompletionChunk["choices"][number]["delta"],
      extra: Partial<Pick<ChatCompletionChunk, "magica">> & { finish?: boolean } = {},
    ): ChatCompletionChunk => ({
      id: `chatcmpl-${sent.run.runId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [{ index: 0, delta, finish_reason: extra.finish ? "stop" : null }],
      ...(extra.magica && { magica: extra.magica }),
    });

    // Tool results only carry the call id; the name comes from the call's input.
    const toolNames = new Map<string, string>();
    const tool = (t: NonNullable<ChatCompletionChunk["magica"]>["tool"]) =>
      chunk({}, { magica: { ...ids, tool: t } });
    /** One stream part as an SSE payload, or nothing for parts OpenAI clients have no use for. */
    const toEvent = (part: UIMessageChunk) => {
      if (part.type === "text-delta") return chunk({ content: part.delta });
      if (part.type === "tool-input-available") {
        toolNames.set(part.toolCallId, part.toolName);
        return tool({ id: part.toolCallId, name: part.toolName, input: part.input });
      }
      if (part.type === "tool-output-available")
        return tool({
          id: part.toolCallId,
          name: toolNames.get(part.toolCallId) ?? "",
          output: part.output,
        });
      if (part.type === "error") return { error: { message: part.errorText, ...ids } };
      return undefined;
    };

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(sse(chunk({ role: "assistant" }, { magica: ids })));
        let ended = false;
        try {
          const parts = await runTask.read(
            triggerRunId,
            AbortSignal.any([request, AbortSignal.timeout(STREAM_MS)]),
          );
          for await (const part of parts) {
            // The stream stays open a while after the run; the reply's own end is the signal.
            if (part.type === "finish") {
              ended = true;
              break;
            }
            const event = toEvent(part);
            if (event) controller.enqueue(sse(event));
          }
        } catch {
          // Timed out or the caller left: the run carries on and can be polled.
        }
        controller.enqueue(
          sse(
            chunk(
              {},
              ended ? { finish: true } : { magica: { ...ids, status: "running" }, finish: false },
            ),
          ),
        );
        controller.enqueue(sse("[DONE]"));
        controller.close();
      },
    });
  },
};
