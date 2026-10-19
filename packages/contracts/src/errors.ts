import { z } from "zod";

/** Closed set of error codes. Every API error, run failure and tool failure uses one of these. */
export const ErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "RUN_ACTIVE",
  "RATE_LIMITED",
  "INSUFFICIENT_CREDITS",
  "UNSUPPORTED_MODEL",
  "MODEL_UNAVAILABLE",
  "EMPTY_RESPONSE",
  "INVALID_TOOL_INPUT",
  "PROVIDER_AUTH",
  "PROVIDER_CREDITS",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_ERROR",
  "GENERATION_FAILED",
  "GENERATION_TIMEOUT",
  "APPROVAL_DECLINED",
  "WAITPOINT_EXPIRED",
  "WAITPOINT_CLOSED",
  "UPLOAD_QUOTA_EXCEEDED",
  "STALE",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** HTTP status for each code; `satisfies` forces a status for every new code. */
export const errorStatus = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  RUN_ACTIVE: 409,
  RATE_LIMITED: 429,
  INSUFFICIENT_CREDITS: 402,
  UNSUPPORTED_MODEL: 400,
  MODEL_UNAVAILABLE: 503,
  EMPTY_RESPONSE: 502,
  INVALID_TOOL_INPUT: 422,
  PROVIDER_AUTH: 502,
  PROVIDER_CREDITS: 502,
  PROVIDER_RATE_LIMITED: 503,
  PROVIDER_ERROR: 502,
  GENERATION_FAILED: 502,
  GENERATION_TIMEOUT: 504,
  /** The user said no to a credit approval or a plan: the tool didn't run. */
  APPROVAL_DECLINED: 409,
  /** Nobody answered in time; the run moved on. */
  WAITPOINT_EXPIRED: 410,
  /** An answer to a waitpoint that is no longer pending (expired or cancelled). */
  WAITPOINT_CLOSED: 409,
  /** The month's 5 GB upload allowance (Transloadit Community) is used up. */
  UPLOAD_QUOTA_EXCEEDED: 403,
  STALE: 500,
  INTERNAL: 500,
} as const satisfies Record<ErrorCode, number>;

/** The one error envelope every endpoint returns: `{ error: { code, message, details?, traceId } }`. */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    traceId: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
