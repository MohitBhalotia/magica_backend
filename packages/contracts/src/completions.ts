import { z } from "zod";

/**
 * `POST /chat/completions` (PRD §6.8): the OpenAI chat-completions shape, answered by our agent.
 * The last `user` message is the new turn. Pass `chat_id` to continue a chat (its history comes
 * from the chat itself, not from `messages`); without it a new chat is created.
 */
export const ChatCompletionRequestSchema = z.object({
  /** Only `openrouter/free` is allowed (brief); anything else is UNSUPPORTED_MODEL. */
  model: z.string(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().max(20_000),
      }),
    )
    .min(1)
    .max(100),
  stream: z.boolean().default(false),
  chat_id: z.string().optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

const UsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
});

/** The finished answer (`stream: false`), with our chat and run ids alongside OpenAI's fields. */
export const ChatCompletionSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number(),
      message: z.object({ role: z.literal("assistant"), content: z.string() }),
      finish_reason: z.enum(["stop", "length"]),
    }),
  ),
  usage: UsageSchema.nullable(),
  chat_id: z.string(),
  run_id: z.string(),
});
export type ChatCompletion = z.infer<typeof ChatCompletionSchema>;

/**
 * One `stream: true` server-sent event. Tool steps ride in `magica`, which OpenAI clients ignore;
 * the last chunk has a `finish_reason` and is followed by `data: [DONE]`.
 */
export const ChatCompletionChunkSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion.chunk"),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number(),
      delta: z.object({ role: z.literal("assistant").optional(), content: z.string().optional() }),
      finish_reason: z.enum(["stop", "length"]).nullable(),
    }),
  ),
  magica: z
    .object({
      chat_id: z.string(),
      run_id: z.string(),
      /** A tool the agent called, then its result. */
      tool: z
        .object({
          id: z.string(),
          name: z.string(),
          input: z.unknown().optional(),
          output: z.unknown().optional(),
        })
        .optional(),
      /** Set when the stream ends before the run (it waits on a long generation or approval). */
      status: z.string().optional(),
    })
    .optional(),
});
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;
