import { z } from "zod";

import { RunStatusSchema } from "./run.ts";

/** Trigger.dev Realtime stream ids written by `agent-turn`: plain text deltas. */
export const TEXT_STREAM = "text";
export const REASONING_STREAM = "reasoning";

/** Run metadata pushed to the browser. Kept small; Postgres stays the source of truth. */
export const RunMetadataSchema = z.object({
  status: RunStatusSchema,
  thinkingMs: z.int().nonnegative().optional(),
});
export type RunMetadata = z.infer<typeof RunMetadataSchema>;
