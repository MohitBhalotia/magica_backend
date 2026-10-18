import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, type LanguageModel } from "ai";

import { AppError } from "@/lib/errors";
import { workerEnv } from "@/lib/workerEnv";

/**
 * The only model the app may call (brief): OpenRouter Free through the Vercel AI SDK, which owns
 * streaming, abort and error parsing. "strict" asks OpenRouter for token usage on streams.
 */
export function openRouterFree(
  options: { apiKey?: string; fetch?: typeof fetch } = {},
): LanguageModel {
  const { OPENROUTER_API_KEY, OPENROUTER_MODEL } = options.apiKey
    ? { OPENROUTER_API_KEY: options.apiKey, OPENROUTER_MODEL: "openrouter/free" as const }
    : workerEnv();
  return createOpenRouter({
    apiKey: OPENROUTER_API_KEY,
    compatibility: "strict",
    fetch: options.fetch,
  }).chat(OPENROUTER_MODEL);
}

/**
 * Any model-call failure → a provider `AppError` with a user-safe message; provider internals stay
 * in `details` for logs. 429/503 carry Retry-After so the agent can back off durably.
 */
export function toProviderError(err: unknown): AppError {
  const status = APICallError.isInstance(err) ? (err.statusCode ?? 502) : 502;
  const retryAfter = APICallError.isInstance(err)
    ? err.responseHeaders?.["retry-after"]
    : undefined;
  const details = { status, detail: err instanceof Error ? err.message : String(err) };
  if (status === 429 || status === 503)
    return new AppError(
      "PROVIDER_RATE_LIMITED",
      "Free models are busy right now. Try again in a minute.",
      { ...details, retryAfterSeconds: Number(retryAfter) || undefined },
      { retryable: true, cause: err },
    );
  if (status === 401 || status === 403)
    return new AppError("PROVIDER_AUTH", "The model provider rejected our credentials.", details, {
      cause: err,
    });
  if (status === 402)
    return new AppError("PROVIDER_CREDITS", "The model provider is out of credits.", details, {
      cause: err,
    });
  return new AppError("PROVIDER_ERROR", "The model provider failed. Try again.", details, {
    retryable: status >= 500,
    cause: err,
  });
}
