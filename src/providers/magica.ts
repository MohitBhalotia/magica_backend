import { z } from "zod";

import type { ErrorCode } from "@mohitbhalotia/magica-contracts";

import { AppError } from "@/lib/errors";
import { workerEnv } from "@/lib/workerEnv";

/*
 * Magica REST client (https://magica.com/docs), used by the worker's tools. The API key never
 * leaves this file: it isn't logged, put in errors or shown to the model.
 */

// ─── Response shapes ────────────────────────────────────────────────────────────────────────────

const CatalogModelSchema = z.object({
  modelId: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string().optional(),
});

/** `GET /models/search`: models grouped by category, e.g. `{ utility: [crop_image, …] }`. */
const SearchResponseSchema = z.object({
  modelCatalog: z.record(z.string(), z.array(CatalogModelSchema)).default({}),
  /** What each category is for, in Magica's words. */
  categoryRoles: z.record(z.string(), z.string()).default({}),
  noMatch: z.string().optional(),
});

/** `GET /models/{id}/schema`: a model's input fields and defaults, kept as Magica sends them. */
const ModelSchemaResponseSchema = z.looseObject({
  modelId: z.string(),
  name: z.string(),
  fields: z.array(z.record(z.string(), z.unknown())),
  defaults: z.record(z.string(), z.unknown()),
});
type ModelSchemaResponse = z.infer<typeof ModelSchemaResponseSchema>;

/** `POST /nodes/{nodeType}/run` (202). Its webhook signing secret isn't kept: see `getRun`. */
const RunCreatedSchema = z.object({ runId: z.string() });

/** `GET /nodes/runs/{id}`: a run's status and, once COMPLETED, the model's output. */
const RunSchema = z.looseObject({
  id: z.string(),
  status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELED"]),
  /** Absent until the run completes. */
  output: z.unknown().optional(),
  /** Magica's user-safe reason for a failed run. */
  userMessage: z.string().nullish(),
  /** Microcredits. */
  creditUsed: z.number().optional(),
});
export type MagicaRun = z.infer<typeof RunSchema>;

/** `POST /nodes/estimate-credits`: one estimate per node sent, in order. */
const EstimateSchema = z.object({
  estimates: z.array(z.object({ microcredits: z.number() })).min(1),
});

/** Magica's error body: `{ error, message, code, traceId }`, any of which may be missing. */
const ErrorBodySchema = z
  .object({ message: z.string().optional(), traceId: z.string().optional() })
  .catch({});

// ─── Errors (PRD §5.6) ──────────────────────────────────────────────────────────────────────────

/** HTTP status → our error code and a safe message. Anything not listed is a provider error. */
const STATUS_ERRORS: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: "INVALID_TOOL_INPUT", message: "Magica rejected the input." },
  401: { code: "PROVIDER_AUTH", message: "Magica rejected our API key." },
  403: { code: "PROVIDER_CREDITS", message: "Not enough Magica credits for this." },
  404: { code: "MODEL_UNAVAILABLE", message: "That Magica model isn't available." },
  410: { code: "MODEL_UNAVAILABLE", message: "That Magica model has been retired." },
  429: { code: "PROVIDER_RATE_LIMITED", message: "Magica is busy right now. Try again shortly." },
};

async function errorFromResponse(response: Response): Promise<AppError> {
  const body = ErrorBodySchema.parse(await response.json().catch(() => null));
  const { status } = response;
  const details = { status, magicaTraceId: body.traceId };
  const known = STATUS_ERRORS[status];

  if (!known) {
    return new AppError("PROVIDER_ERROR", "Magica failed. Try again.", details, {
      retryable: status >= 500,
    });
  }
  if (status === 400) {
    // Validation feedback is safe and useful: the model reads it and fixes its input.
    return new AppError(known.code, body.message ?? known.message, details);
  }
  if (status === 429) {
    const retryAfterSeconds = Number(response.headers.get("retry-after")) || undefined;
    return new AppError(
      known.code,
      known.message,
      { ...details, retryAfterSeconds },
      {
        retryable: true,
      },
    );
  }
  return new AppError(known.code, known.message, details);
}

// ─── Requests ───────────────────────────────────────────────────────────────────────────────────

/** A hung connection must not hold the turn. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * One authenticated request (a POST when there's a `body`), with the response checked against
 * `schema`. `signal` is the turn's abort signal: Stop cancels the request, and so does the timeout.
 */
async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  { signal, body }: { signal?: AbortSignal; body?: unknown } = {},
): Promise<z.infer<S>> {
  const { MAGICA_API_KEY, MAGICA_BASE_URL } = workerEnv();
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${MAGICA_BASE_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${MAGICA_API_KEY}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // the turn was stopped: not a Magica problem
    const message = timeout.aborted ? "Magica took too long to answer." : "Couldn't reach Magica.";
    throw new AppError("PROVIDER_ERROR", message, undefined, { cause: err, retryable: true });
  }

  if (!response.ok) throw await errorFromResponse(response);
  return schema.parse(await response.json());
}

/** Schemas change rarely: keep each one for the life of the worker process. */
const schemaCache = new Map<string, ModelSchemaResponse>();

export const magica = {
  /** Magica's own model search, by what the user wants to do. */
  searchModels: (query: string, signal?: AbortSignal) =>
    request(`/models/search?query=${encodeURIComponent(query)}`, SearchResponseSchema, { signal }),

  /** A model's live input fields and defaults. */
  async modelSchema(modelId: string, signal?: AbortSignal): Promise<ModelSchemaResponse> {
    const cached = schemaCache.get(modelId);
    if (cached) return cached;

    const path = `/models/${encodeURIComponent(modelId)}/schema`;
    const schema = await request(path, ModelSchemaResponseSchema, { signal });
    schemaCache.set(modelId, schema);
    return schema;
  },

  /**
   * Starts a model run. Magica has no idempotency key, so callers must save the returned id
   * before anything else can fail. `webhookUrl` is called when the run ends.
   */
  createRun: (job: MagicaJob, webhookUrl: string, signal?: AbortSignal) =>
    request(`/nodes/${encodeURIComponent(job.nodeType)}/run`, RunCreatedSchema, {
      signal,
      body: {
        input: job.input,
        subModelId: job.subModelId,
        webhook: { url: webhookUrl, events: ["run.completed", "run.failed", "run.canceled"] },
      },
    }),

  /** What a run would cost, in microcredits. Free; it can fail for some inputs (seen for merges). */
  async estimate(job: MagicaJob, signal?: AbortSignal) {
    const node = { type: job.nodeType, subModelId: job.subModelId, data: job.input };
    const { estimates } = await request("/nodes/estimate-credits", EstimateSchema, {
      signal,
      body: { nodes: [node] },
    });
    return estimates[0]?.microcredits ?? 0;
  },

  /** A run's current status and output, read with our key: the only result we trust. */
  getRun: (runId: string, signal?: AbortSignal) =>
    request(`/nodes/runs/${encodeURIComponent(runId)}`, RunSchema, { signal }),
};

/** One model run: the node type, an optional mode (sub-model) and the model's input fields. */
export type MagicaJob = { nodeType: string; subModelId?: string; input: Record<string, unknown> };
