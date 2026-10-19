import { z } from "zod";

import { ToolNameSchema } from "./tools.ts";

/**
 * Waitpoints (PRD §5.8, DEC-055): a run paused until the user answers. One entry per type, with
 * what the run asks and what the user answers; the backend checks answers and the frontend picks
 * an overlay from this same registry.
 */
export const WAITPOINTS = {
  /** A Magica run that costs more than the approval threshold, or whose cost is unknown. */
  credit_approval: {
    request: z.object({
      tool: ToolNameSchema,
      /** Null when Magica couldn't estimate the cost. */
      estimateMicro: z.number().nullable(),
      balanceMicro: z.number(),
    }),
    response: z.object({ approved: z.boolean() }),
  },
  /** The agent asks the user to pick one of a few answers (the `ask_user` tool). */
  options: {
    request: z.object({
      question: z.string().min(1).max(500),
      options: z.array(z.string().min(1).max(200)).min(2).max(6),
    }),
    response: z.object({ choice: z.string().min(1).max(200) }),
  },
  /** The agent proposes a plan before billable steps (the `propose_plan` tool). */
  plan_approval: {
    request: z.object({ plan: z.string().min(1).max(4000) }),
    response: z.object({
      approved: z.boolean(),
      feedback: z.string().max(1000).optional(),
    }),
  },
} as const;

export type WaitpointType = keyof typeof WAITPOINTS;
export type WaitpointRequest<T extends WaitpointType> = z.infer<(typeof WAITPOINTS)[T]["request"]>;
export type WaitpointResponse<T extends WaitpointType> = z.infer<
  (typeof WAITPOINTS)[T]["response"]
>;

// Mirror the Prisma enums; a backend type check fails CI on any drift (DEC-048).
export const WaitpointTypeSchema = z.enum(
  Object.keys(WAITPOINTS) as [WaitpointType, ...WaitpointType[]],
);
export const WaitpointStatusSchema = z.enum(["pending", "answered", "expired", "cancelled"]);

/** A waitpoint as the browser sees it: in the run's realtime metadata, and on `activeRun`. */
export const WaitpointSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("credit_approval"), request: WAITPOINTS.credit_approval.request }),
    z.object({ type: z.literal("options"), request: WAITPOINTS.options.request }),
    z.object({ type: z.literal("plan_approval"), request: WAITPOINTS.plan_approval.request }),
  ])
  .and(
    z.object({
      id: z.string(),
      status: WaitpointStatusSchema,
      expiresAt: z.iso.datetime(),
    }),
  );
export type Waitpoint = z.infer<typeof WaitpointSchema>;

/** `POST /waitpoints/:id/respond`; the answer is checked against the waitpoint's own type. */
export const RespondWaitpointRequestSchema = z.object({ response: z.unknown() });

/** The run's realtime metadata key that carries its pending waitpoint. */
export const WAITPOINT_METADATA_KEY = "waitpoint";
