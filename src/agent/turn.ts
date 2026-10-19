import {
  APICallError,
  createUIMessageStream,
  RetryError,
  StreamProviderError,
  streamText,
  toUIMessageStream,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
} from "ai";

import {
  ContentBlockSchema,
  MessageMetadataSchema,
  type MessageMetadata,
} from "@mohitbhalotia/magica-contracts";

import { AppError } from "@/lib/errors";

export const SYSTEM_PROMPT =
  "You are Magica, a helpful AI assistant. Answer clearly and concisely, using Markdown when it helps.";

/** The assistant message as the AI SDK streams it; its parts are our content blocks (DEC-052). */
export type AgentMessage = UIMessage<MessageMetadata>;

export type TurnEnd = {
  status: "completed" | "failed" | "cancelled";
  /** Missing only if the stream itself broke before the turn ended. */
  message?: AgentMessage;
  error?: unknown;
  usage?: LanguageModelUsage;
  routedModel?: string;
};

/** Thinking time, from the first reasoning part to the last, sent as message metadata. */
function thinkingTimer() {
  let startedAt: number | undefined;
  return ({ part }: { part: TextStreamPart<ToolSet> }): MessageMetadata | undefined => {
    if (part.type === "reasoning-start") startedAt ??= Date.now();
    if (part.type === "reasoning-end" && startedAt !== undefined)
      return { thinkingMs: Date.now() - startedAt };
    return undefined;
  };
}

const hasText = (message: AgentMessage) =>
  message.parts.some((p) => p.type === "text" && p.text.trim());

/**
 * One model answer as a UI message stream. The SDK retries a busy model (honouring Retry-After)
 * and provider errors mid-stream; we retry an empty answer once. `ended` resolves when the stream
 * has been fully read, with everything needed to save the turn (Stop and failures included).
 */
export function streamTurn(input: {
  model: LanguageModel;
  messages: ModelMessage[];
  signal?: AbortSignal;
}) {
  const { model, messages, signal } = input;
  const ended = Promise.withResolvers<TurnEnd>();
  let usage: LanguageModelUsage | undefined;
  let routedModel: string | undefined;

  const stream = createUIMessageStream<AgentMessage>({
    async execute({ writer }) {
      writer.write({ type: "start" });
      for (let attempt = 1; ; attempt++) {
        let error: unknown;
        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages,
          abortSignal: signal,
          maxRetries: 3,
          streamRetries: 1,
          onError: (event) => {
            error = event.error;
          },
          onEnd: (event) => {
            usage = event.usage;
            routedModel = event.finalStep.response.modelId;
          },
        });
        const answer = Promise.withResolvers<AgentMessage>();
        writer.merge(
          toUIMessageStream<ToolSet, AgentMessage>({
            stream: result.stream,
            sendStart: false,
            messageMetadata: thinkingTimer(),
            onError: (err) => toTurnError(err).message,
            onEnd: ({ responseMessage }) => {
              answer.resolve(responseMessage);
            },
          }),
        );
        const message = await answer.promise;
        // Error chunks alone don't fail the stream; the outcome carries the error to `onEnd`.
        if (error !== undefined) writer.setOutcome({ status: "failed", error });
        if (error !== undefined || signal?.aborted || hasText(message)) return;
        if (attempt === 2)
          throw new AppError("EMPTY_RESPONSE", "The model returned an empty answer. Try again.");
      }
    },
    onError: (err) => toTurnError(err).message,
    onEnd: ({ responseMessage, isAborted, outcome }) => {
      const failed = outcome.status === "failed";
      ended.resolve({
        status: isAborted || signal?.aborted ? "cancelled" : failed ? "failed" : "completed",
        message: responseMessage,
        error: failed ? outcome.error : undefined,
        usage,
        routedModel,
      });
    },
  });
  return { stream, ended: ended.promise };
}

/** The saved form of a streamed message: known parts only, plain text, validated metadata. */
export function toStored(message?: AgentMessage) {
  // Parts we don't render yet (e.g. sources) are dropped rather than failing the save.
  const blocks = (message?.parts ?? []).flatMap((part) => {
    const block = ContentBlockSchema.safeParse(part);
    return block.success ? [block.data] : [];
  });
  return {
    blocks,
    // Models often open with blank lines; the plain text feeds previews, search and copy.
    text: blocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim(),
    metadata: MessageMetadataSchema.parse(message?.metadata ?? {}),
  };
}

/**
 * Any turn failure → an `AppError` with a user-safe message (the original stays in `cause` for
 * logs). It runs after the SDK's own retries, so a model that is still busy is MODEL_UNAVAILABLE.
 */
export function toTurnError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const last = RetryError.isInstance(err) ? err.lastError : err;
  if (!APICallError.isInstance(last) && !StreamProviderError.isInstance(last))
    return new AppError("INTERNAL", "Something went wrong. Please try again.", undefined, {
      cause: err,
    });
  const status = last.statusCode ?? 502;
  const options = { cause: err, retryable: true };
  if (status === 429 || status === 503)
    return new AppError(
      "MODEL_UNAVAILABLE",
      "Free models are busy right now. Try again in a minute.",
      { status },
      options,
    );
  if (status === 401 || status === 403)
    return new AppError("PROVIDER_AUTH", "The model provider rejected our credentials.", {
      status,
    });
  if (status === 402)
    return new AppError("PROVIDER_CREDITS", "The model provider is out of credits.", { status });
  return new AppError(
    "PROVIDER_ERROR",
    "The model provider failed. Try again.",
    { status },
    { ...options, retryable: status >= 500 },
  );
}
