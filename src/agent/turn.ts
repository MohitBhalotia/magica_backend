import { streamText, type LanguageModel, type LanguageModelUsage, type ModelMessage } from "ai";

import type { ContentBlock } from "@mohitbhalotia/magica-contracts";

import { AppError } from "@/lib/errors";
import { toProviderError } from "@/providers/openrouter";

export const SYSTEM_PROMPT =
  "You are Magica, a helpful AI assistant. Answer clearly and concisely, using Markdown when it helps.";

/** Free models are often busy: back off this many times before giving up. */
const BUSY_RETRIES = 3;
const MAX_BACKOFF_SECONDS = 60;

/** The answer so far. Filled as deltas arrive, so Stop or a failure can keep the partial text. */
export type Draft = { text: string; reasoning: string; reasoningMs?: number };

export type TurnResult = { usage?: LanguageModelUsage; routedModel?: string };

export type TurnInput = {
  model: LanguageModel;
  messages: ModelMessage[];
  draft: Draft;
  signal?: AbortSignal;
  onText: (delta: string) => Promise<void>;
  onReasoning: (delta: string) => Promise<void>;
  /** Durable wait between retries (`wait.for` in the task). */
  sleep: (seconds: number) => Promise<void>;
};

/** The assistant message's blocks: reasoning (if any) first, then the answer. */
export const toBlocks = (draft: Draft): ContentBlock[] => [
  ...(draft.reasoning
    ? [{ type: "reasoning" as const, text: draft.reasoning, durationMs: draft.reasoningMs }]
    : []),
  ...(draft.text ? [{ type: "text" as const, text: draft.text }] : []),
];

async function streamOnce({ model, messages, draft, signal, onText, onReasoning }: TurnInput) {
  const { stream } = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages,
    abortSignal: signal,
    maxRetries: 0, // retries are ours: durable waits that honour Retry-After
  });
  const result: TurnResult = {};
  let reasoningStartedAt: number | undefined;
  // Other parts (step boundaries, and tool parts from M3) carry nothing to store yet.
  for await (const part of stream) {
    if (part.type === "reasoning-delta") {
      reasoningStartedAt ??= Date.now();
      draft.reasoning += part.text;
      await onReasoning(part.text);
    } else if (part.type === "text-delta") {
      if (reasoningStartedAt !== undefined) draft.reasoningMs ??= Date.now() - reasoningStartedAt;
      draft.text += part.text;
      await onText(part.text);
    } else if (part.type === "finish-step") result.routedModel = part.response.modelId;
    else if (part.type === "finish") result.usage = part.totalUsage;
    else if (part.type === "error") throw part.error;
  }
  signal?.throwIfAborted();
  return result;
}

/**
 * One model answer, streamed into `draft` and the sinks. Busy (429/503) → durable backoff, at most
 * 3 times, then MODEL_UNAVAILABLE; empty answer → one more try, then EMPTY_RESPONSE. Only retries
 * while no text was streamed, so the browser never sees an answer twice.
 */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  for (let busy = 0, empty = 0; ;) {
    try {
      const result = await streamOnce(input);
      if (input.draft.text.trim()) return result;
      if (empty++ >= 1)
        throw new AppError("EMPTY_RESPONSE", "The model returned an empty answer. Try again.");
      input.draft.reasoning = "";
    } catch (err) {
      if (input.signal?.aborted || err instanceof AppError) throw err;
      const error = toProviderError(err);
      if (error.code !== "PROVIDER_RATE_LIMITED") throw error;
      if (busy >= BUSY_RETRIES || input.draft.text)
        throw new AppError("MODEL_UNAVAILABLE", error.message, error.details, { cause: err });
      const retryAfter = Number(error.details?.retryAfterSeconds) || 5 * 2 ** busy;
      busy++;
      input.draft.reasoning = "";
      await input.sleep(Math.min(retryAfter, MAX_BACKOFF_SECONDS));
    }
  }
}
