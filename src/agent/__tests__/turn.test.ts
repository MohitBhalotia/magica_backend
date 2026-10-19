import { APICallError, simulateReadableStream, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { streamTurn, toStored, toTurnError } from "@/agent/turn";
import { AppError } from "@/lib/errors";

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

// retry-after-ms 0 keeps the SDK's busy-model backoff instant in tests.
const httpError = (statusCode: number) =>
  new APICallError({
    message: `HTTP ${String(statusCode)}`,
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseHeaders: { "retry-after-ms": "0" },
  });

/** The model answers with `first` on the first call and `then` on every later call. */
async function turn(first: () => ReturnType<typeof answer>, then = first, signal?: AbortSignal) {
  const doStream = vi.fn(() =>
    Promise.resolve(doStream.mock.calls.length === 1 ? first() : then()),
  );
  const { stream, ended } = streamTurn({
    model: new MockLanguageModelV4({ doStream }),
    messages: [{ role: "user", content: "Hi" }],
    signal,
  });
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);
  return { end: await ended, chunks, calls: doStream.mock.calls.length };
}

const busy = () => {
  throw httpError(503);
};

describe("streamTurn", () => {
  it("streams reasoning and text as UI chunks and ends with the saved message", async () => {
    const { end, chunks } = await turn(() => answer("Hello", ", world"));

    expect(chunks.map((c) => c.type)).toContain("reasoning-delta");
    expect(end).toMatchObject({ status: "completed", usage: { totalTokens: 8 } });
    const stored = toStored(end.message);
    expect(stored.text).toBe("Hello, world");
    expect(stored.blocks.map((b) => b.type)).toEqual(["step-start", "reasoning", "text"]);
    expect(stored.metadata.thinkingMs).toBeGreaterThanOrEqual(0);
  });

  it("retries a busy model inside the SDK, then answers", async () => {
    const { end, calls } = await turn(busy, () => answer("Done"));

    expect(calls).toBe(2);
    expect(end.status).toBe("completed");
    expect(toStored(end.message).text).toBe("Done");
  });

  it("gives up on a model that stays busy with MODEL_UNAVAILABLE and a safe error chunk", async () => {
    const { end, chunks, calls } = await turn(busy);

    expect(calls).toBe(4); // first try + 3 SDK retries
    expect(end.status).toBe("failed");
    expect(toTurnError(end.error).code).toBe("MODEL_UNAVAILABLE");
    expect(chunks).toContainEqual({
      type: "error",
      errorText: "Free models are busy right now. Try again in a minute.",
    });
  });

  it("retries an empty answer once, then fails with EMPTY_RESPONSE", async () => {
    const empty = await turn(() => answer());
    expect(empty.calls).toBe(2);
    expect(empty.end.status).toBe("failed");
    expect(toTurnError(empty.end.error).code).toBe("EMPTY_RESPONSE");

    const recovered = await turn(
      () => answer(),
      () => answer("Second time"),
    );
    expect(recovered.end.status).toBe("completed");
    expect(toStored(recovered.end.message).text).toBe("Second time");
  });

  it("does not retry an auth error", async () => {
    const { end, calls } = await turn(() => {
      throw httpError(401);
    });

    expect(calls).toBe(1);
    expect(toTurnError(end.error).code).toBe("PROVIDER_AUTH");
  });

  it("a stopped turn ends as cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const { end } = await turn(() => answer("Partial"), undefined, controller.signal);

    expect(end.status).toBe("cancelled");
  });
});

describe("toTurnError", () => {
  it("never leaks an unknown failure, and keeps app errors as they are", () => {
    const internal = toTurnError(new Error("db password=hunter2"));
    expect(internal.code).toBe("INTERNAL");
    expect(internal.message).not.toContain("hunter2");

    const empty = new AppError("EMPTY_RESPONSE", "Empty.");
    expect(toTurnError(empty)).toBe(empty);
  });

  it("maps credits and server errors to safe provider codes", () => {
    expect(toTurnError(httpError(402)).code).toBe("PROVIDER_CREDITS");
    expect(toTurnError(httpError(500))).toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
    expect(toTurnError(httpError(400))).toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
  });
});
