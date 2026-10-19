import { z } from "zod";

import { ToolNameSchema, ToolStateSchema } from "./tools.ts";

const state = z.enum(["streaming", "done"]).optional();

/**
 * A tool call and its result, as the AI SDK's `tool-<name>` UI part. Input and output are each
 * tool's own shapes, validated by that tool on the backend before they're saved.
 */
export const ToolBlockSchema = z.object({
  type: z.templateLiteral(["tool-", ToolNameSchema]),
  toolCallId: z.string(),
  state: ToolStateSchema,
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  errorText: z.string().optional(),
});
export type ToolBlock = z.infer<typeof ToolBlockSchema>;

/**
 * A message's ordered content: a Zod copy of the AI SDK's `UIMessage` parts (DEC-052), so a live
 * (streamed) message and a saved one have the same shape and one renderer. Stored as JSONB and
 * validated before every write.
 */
export const ContentBlockSchema = z.union([
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string(), state }),
    /** The model's thinking, shown collapsed ("Thought for Ns"). */
    z.object({ type: z.literal("reasoning"), text: z.string(), state }),
    /** Boundary between model steps: each tool round trip starts a new step. */
    z.object({ type: z.literal("step-start") }),
  ]),
  ToolBlockSchema,
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const ContentBlocksSchema = z.array(ContentBlockSchema);

/** `UIMessage.metadata` of an assistant message: streamed live, then saved with the message. */
export const MessageMetadataSchema = z.object({
  thinkingMs: z.int().nonnegative().optional(),
  /** How long each finished tool call took, by `toolCallId` (the step row's duration). */
  toolMs: z.record(z.string(), z.int().nonnegative()).optional(),
});
export type MessageMetadata = z.infer<typeof MessageMetadataSchema>;
