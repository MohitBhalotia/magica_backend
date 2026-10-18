import { z } from "zod";

import { ErrorCodeSchema } from "./errors.ts";

/**
 * A message's ordered content (PRD §6.2). Stored as JSONB and validated before every write.
 * M2 subset; later milestones add tool_use, tool_result, asset_ref… to this one union.
 */
export const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  /** The model's thinking, shown collapsed ("Thought for Ns"). */
  z.object({
    type: z.literal("reasoning"),
    text: z.string(),
    durationMs: z.int().nonnegative().optional(),
  }),
  /** A visible status line inside a turn, e.g. why it stopped or failed. Safe copy only. */
  z.object({
    type: z.literal("notice"),
    level: z.enum(["info", "warning", "error"]),
    code: ErrorCodeSchema.optional(),
    message: z.string(),
  }),
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const ContentBlocksSchema = z.array(ContentBlockSchema);
