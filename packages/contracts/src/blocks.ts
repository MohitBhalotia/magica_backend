import { z } from "zod";

const state = z.enum(["streaming", "done"]).optional();

/**
 * A message's ordered content: a Zod copy of the AI SDK's `UIMessage` parts (DEC-052), so a live
 * (streamed) message and a saved one have the same shape and one renderer. Stored as JSONB and
 * validated before every write. M2 subset; M3 adds `tool-*` and `data-*` parts to this union.
 */
export const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string(), state }),
  /** The model's thinking, shown collapsed ("Thought for Ns"). */
  z.object({ type: z.literal("reasoning"), text: z.string(), state }),
  /** Boundary between model steps; multi-step turns arrive with tools (M3). */
  z.object({ type: z.literal("step-start") }),
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const ContentBlocksSchema = z.array(ContentBlockSchema);

/** `UIMessage.metadata` of an assistant message: streamed live, then saved with the message. */
export const MessageMetadataSchema = z.object({
  thinkingMs: z.int().nonnegative().optional(),
});
export type MessageMetadata = z.infer<typeof MessageMetadataSchema>;
