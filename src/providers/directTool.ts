import { simulateReadableStream, type LanguageModel } from "ai";

/**
 * A stand-in "model" for `POST /tools/{tool}/run` (PRD §6.8): it asks for exactly one tool call
 * with exactly the caller's input, then stops once the result is back. Running it through the
 * normal turn keeps one path for validation, credits, approvals, persistence, Stop and recovery.
 * It never calls an LLM, so it spends nothing.
 */
export function directTool(toolName: string, input: unknown): Exclude<LanguageModel, string> {
  const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 0, text: 0, reasoning: undefined },
  };
  const finish = (reason: "stop" | "tool-calls") => ({
    type: "finish" as const,
    finishReason: { unified: reason, raw: undefined },
    usage,
  });
  return {
    specificationVersion: "v4",
    provider: "magica",
    modelId: "direct-tool",
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error("directTool only streams")),
    doStream: (options) => {
      // Second step: the tool's result is already in the prompt, so the turn ends here.
      const answered = options.prompt.at(-1)?.role === "tool";
      const chunks = answered
        ? [finish("stop")]
        : [
            {
              type: "tool-call" as const,
              toolCallId: "direct-1",
              toolName,
              input: JSON.stringify(input),
            },
            finish("tool-calls"),
          ];
      return Promise.resolve({ stream: simulateReadableStream({ chunks }) });
    },
  };
}
