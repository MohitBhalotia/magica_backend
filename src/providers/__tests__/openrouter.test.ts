import { APICallError, streamText, type TextStreamPart, type ToolSet } from "ai";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { toTurnError } from "@/agent/turn";
import { openRouterFree } from "@/providers/openrouter";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const encoder = new TextEncoder();
const sse = (...frames: object[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": OPENROUTER PROCESSING\n\n"));
      for (const f of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(f)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

/** Runs one turn against the mocked endpoint and returns every stream part. */
async function run() {
  // Created after MSW starts listening, so requests go through the mock.
  const result = streamText({
    model: openRouterFree({ apiKey: "sk-or-test" }),
    prompt: "hi",
    maxRetries: 0,
  });
  const parts: TextStreamPart<ToolSet>[] = [];
  for await (const part of result.stream) parts.push(part);
  return parts;
}

describe("openRouterFree", () => {
  it("streams reasoning and text, reports the routed model and usage, pins the free model", async () => {
    let body: { model?: string; stream_options?: unknown } = {};
    let auth: string | null = null;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        body = (await request.json()) as typeof body;
        auth = request.headers.get("authorization");
        return new HttpResponse(
          sse(
            { id: "g1", model: "meta/llama-free", choices: [{ delta: { reasoning: "Think" } }] },
            { id: "g1", model: "meta/llama-free", choices: [{ delta: { content: "Hello" } }] },
            {
              id: "g1",
              model: "meta/llama-free",
              choices: [{ delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
            },
          ),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }),
    );

    const parts = await run();
    const text = parts.flatMap((p) => (p.type === "text-delta" ? [p.text] : [])).join("");
    const reasoning = parts.flatMap((p) => (p.type === "reasoning-delta" ? [p.text] : [])).join("");
    const step = parts.find((p) => p.type === "finish-step");
    const finish = parts.find((p) => p.type === "finish");

    expect({ text, reasoning }).toEqual({ text: "Hello", reasoning: "Think" });
    expect(step?.type === "finish-step" && step.response.modelId).toBe("meta/llama-free");
    expect(finish?.type === "finish" && finish.totalUsage).toMatchObject({
      inputTokens: 5,
      outputTokens: 2,
    });
    expect(body).toMatchObject({
      model: "openrouter/free",
      stream_options: { include_usage: true },
    });
    expect(auth).toBe("Bearer sk-or-test");
  });

  it("a 429 from OpenRouter surfaces as an API error that maps to MODEL_UNAVAILABLE", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({ error: { message: "slow down", code: 429 } }, { status: 429 }),
      ),
    );
    const error = (await run()).find((p) => p.type === "error");
    expect(error?.type === "error" && APICallError.isInstance(error.error)).toBe(true);
    expect(error?.type === "error" && toTurnError(error.error).code).toBe("MODEL_UNAVAILABLE");
  });
});
