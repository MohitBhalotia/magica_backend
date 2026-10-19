import { z } from "zod";

import { WaitpointSchema } from "./waitpoints.ts";

/**
 * Agent run lifecycle; mirrors the Prisma enum (parity checked in the backend, DEC-048).
 * queued → thinking → working ⇄ waiting → completed | failed | cancelled; stopping on user Stop.
 */
export const RunStatusSchema = z.enum([
  "queued",
  "thinking",
  "working",
  "waiting",
  "stopping",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TERMINAL_RUN_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const satisfies RunStatus[];

/**
 * What the browser needs to follow a run live: the Trigger.dev run id and a short-lived
 * public token scoped to that one run. `triggerRunId` is null until the run is dispatched.
 */
export const RunHandleSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  triggerRunId: z.string().nullable(),
  publicAccessToken: z.string().nullable(),
  /** The run's pending waitpoint, so a reload shows the question again (PRD §5.8). */
  waitpoint: WaitpointSchema.nullable().default(null),
});
export type RunHandle = z.infer<typeof RunHandleSchema>;
