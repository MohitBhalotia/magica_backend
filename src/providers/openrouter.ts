import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import { workerEnv } from "@/lib/workerEnv";

/**
 * The only model the app may call (brief): OpenRouter Free through the Vercel AI SDK, which owns
 * streaming, retries, abort and error parsing. "strict" asks OpenRouter for token usage on streams.
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
