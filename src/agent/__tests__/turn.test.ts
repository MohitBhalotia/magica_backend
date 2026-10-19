import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { runTurn, toBlocks, type Draft } from "@/agent/turn";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const finish = {
  type: "finish" as const,
  finishReason: { unified: "stop" as const, raw: undefined },
  usage,
};

const answer = (...deltas: string[]) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "reasoning-start" as const, id: "r" },
      { type: "reasoning-delta" as const, id: "r", delta: "Let me think." },
      { type: "reasoning-end" as const, id: "r" },
      { type: "text-start" as const, id: "t" },
      ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
      { type: "text-end" as const, id: "t" },
      finish,
    ],
  }),
});

const httpError = (statusCode: number, headers: Record<string, string> = {}) =>
  new APICallError({
    message: `HTTP ${String(statusCode)}`,
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
  });

/** The model answers with `first` on the first call and `then` on every later call. */
function setup(first: () => ReturnType<typeof answer>, then = first) {
  const doStream = vi.fn(() =>
    Promise.resolve(doStream.mock.calls.length === 1 ? first() : then()),
  );
  const draft: Draft = { text: "", reasoning: "" };
  const io = {
    model: new MockLanguageModelV4({ doStream }),
    messages: [{ role: "user" as const, content: "Hi" }],
    draft,
    onText: vi.fn(() => Promise.resolve()),
    onReasoning: vi.fn(() => Promise.resolve()),
    sleep: vi.fn(() => Promise.resolve()),
  };
  return { io, draft, doStream };
}

describe("runTurn", () => {
  it("streams reasoning and text into the draft and the sinks", async () => {
    const { io, draft } = setup(() => answer("Hello", ", world"));

    const result = await runTurn(io);

    expect(draft).toMatchObject({ text: "Hello, world", reasoning: "Let me think." });
    expect(draft.reasoningMs).toBeGreaterThanOrEqual(0);
    expect(io.onText.mock.calls).toEqual([["Hello"], [", world"]]);
    expect(io.onReasoning).toHaveBeenCalledWith("Let me think.");
    expect(result.usage?.totalTokens).toBe(8);
    expect(toBlocks(draft).map((b) => b.type)).toEqual(["reasoning", "text"]);
  });

  it("backs off on a busy model, honouring Retry-After, then answers", async () => {
    const { io, draft } = setup(
      () => {
        throw httpError(429, { "retry-after": "7" });
      },
      () => answer("Done"),
    );

    await runTurn(io);

    expect(io.sleep).toHaveBeenCalledExactlyOnceWith(7);
    expect(draft.text).toBe("Done");
  });

  it("gives up with MODEL_UNAVAILABLE after 3 busy retries", async () => {
    const { io, doStream } = setup(() => {
      throw httpError(503);
    });

    await expect(runTurn(io)).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    expect(io.sleep.mock.calls).toEqual([[5], [10], [20]]);
    expect(doStream).toHaveBeenCalledTimes(4);
  });

  it("retries an empty answer once, then fails with EMPTY_RESPONSE", async () => {
    const { io, doStream } = setup(() => answer());

    await expect(runTurn(io)).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
    expect(doStream).toHaveBeenCalledTimes(2);
  });

  it("does not retry other provider errors", async () => {
    const { io, doStream } = setup(() => {
      throw httpError(401);
    });

    await expect(runTurn(io)).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
    expect(doStream).toHaveBeenCalledOnce();
  });

  it("stops without retrying when the turn is aborted", async () => {
    const { io, doStream } = setup(() => answer("Partial"));
    const controller = new AbortController();
    controller.abort();

    await expect(runTurn({ ...io, signal: controller.signal })).rejects.toThrow();
    expect(doStream).toHaveBeenCalledOnce();
    expect(io.sleep).not.toHaveBeenCalled();
  });
});
