import { randomUUID } from "node:crypto";

import type { UIMessageChunk } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatCompletionChunkSchema, type SendResponse } from "@mohitbhalotia/magica-contracts";

import { logger } from "@/lib/logger";
import { completionService } from "@/modules/completions/completion.service";

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  send: vi.fn(),
  findMessage: vi.fn(),
  getRun: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/modules/chats/chat.service", () => ({
  chatService: { create: mock.create, send: mock.send },
}));
vi.mock("@/modules/chats/chat.repository", () => ({
  chatRepository: { findMessage: mock.findMessage },
}));
vi.mock("@/modules/runs/run.service", () => ({ runService: { get: mock.getRun } }));
vi.mock("@/modules/runs/run.task", () => ({ runTask: { read: mock.read } }));
vi.mock("node:timers/promises", () => ({ setTimeout: () => Promise.resolve() }));

const ctx = { traceId: "t", logger };
const sent: SendResponse = {
  chatId: "c1",
  userMessageId: "m1",
  assistantMessageId: "m2",
  run: {
    runId: "r1",
    status: "queued",
    triggerRunId: "trig_1",
    publicAccessToken: "pk",
    waitpoint: null,
  },
};
const ask = (content: string, extra = {}) => ({
  model: "openrouter/free",
  messages: [
    { role: "system" as const, content: "Be brief." },
    { role: "user" as const, content },
  ],
  stream: false,
  ...extra,
});
const runIs = (...statuses: string[]) => {
  for (const status of statuses) mock.getRun.mockResolvedValueOnce({ ...sent.run, status });
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.create.mockResolvedValue(sent);
  mock.send.mockResolvedValue(sent);
});

describe("start", () => {
  it("only openrouter/free: any other model is UNSUPPORTED_MODEL and starts nothing", () => {
    expect(() =>
      completionService.start("u1", { ...ask("hi"), model: "gpt-4o" }, undefined, ctx),
    ).toThrow(expect.objectContaining({ code: "UNSUPPORTED_MODEL" }));
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("the last user message starts a new chat, keyed by the Idempotency-Key", async () => {
    const messageId = randomUUID();
    await completionService.start("u1", ask("  Draw a cat  "), messageId, ctx);
    expect(mock.create).toHaveBeenCalledWith("u1", messageId, "Draw a cat", ctx);
  });

  it("chat_id continues that chat", async () => {
    await completionService.start("u1", ask("and a dog", { chat_id: "c9" }), undefined, ctx);
    expect(mock.send).toHaveBeenCalledWith("c9", "u1", expect.any(String), "and a dog", ctx);
  });
});

describe("finish (stream: false)", () => {
  it("waits for the run, then answers in OpenAI's shape with our ids and usage", async () => {
    runIs("working", "completed");
    mock.findMessage.mockResolvedValue({
      text: "A cat.",
      tokenUsage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
    });

    const done = await completionService.finish(sent, "u1");
    expect(done).toMatchObject({
      object: "chat.completion",
      model: "openrouter/free",
      choices: [{ message: { role: "assistant", content: "A cat." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      chat_id: "c1",
      run_id: "r1",
    });
  });

  it("a run waiting on an approval comes back as null (202: poll it)", async () => {
    runIs("waiting");
    await expect(completionService.finish(sent, "u1")).resolves.toBeNull();
  });

  it("a failed turn is its own error code and safe message", async () => {
    runIs("failed");
    mock.findMessage.mockResolvedValue({
      errorCode: "MODEL_UNAVAILABLE",
      errorMessage: "Free models are busy right now.",
    });
    await expect(completionService.finish(sent, "u1")).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
      message: "Free models are busy right now.",
    });
  });
});

describe("stream (stream: true)", () => {
  async function events(parts: UIMessageChunk[]) {
    // `for await` reads a plain array just like the SDK's async iterable.
    mock.read.mockResolvedValue(parts);
    const text = await new Response(
      completionService.stream(sent, "trig_1", new AbortController().signal),
    ).text();
    return text
      .split("\n\n")
      .filter(Boolean)
      .map((line) => line.replace(/^data: /, ""));
  }

  it("text and tool steps become OpenAI chunks, then a stop chunk and [DONE]", async () => {
    const out = await events([
      { type: "start" },
      { type: "tool-input-available", toolCallId: "t1", toolName: "crop_image", input: { x: 1 } },
      { type: "tool-output-available", toolCallId: "t1", output: { imageUrl: "u" } },
      { type: "text-delta", id: "a", delta: "Cropped " },
      { type: "text-delta", id: "a", delta: "it." },
      { type: "finish" },
      { type: "text-delta", id: "a", delta: "never sent" },
    ] as UIMessageChunk[]);

    expect(out.at(-1)).toBe("[DONE]");
    const chunks = out.slice(0, -1).map((e) => ChatCompletionChunkSchema.parse(JSON.parse(e)));
    expect(chunks[0]?.choices[0]?.delta).toEqual({ role: "assistant" });
    expect(chunks[1]?.magica?.tool).toEqual({ id: "t1", name: "crop_image", input: { x: 1 } });
    expect(chunks[2]?.magica?.tool).toMatchObject({
      name: "crop_image",
      output: { imageUrl: "u" },
    });
    expect(chunks.map((c) => c.choices[0]?.delta.content ?? "").join("")).toBe("Cropped it.");
    expect(chunks.at(-1)?.choices[0]?.finish_reason).toBe("stop");
  });

  it("a run that outlives the stream ends with its status, not a stop", async () => {
    const out = await events([
      { type: "text-delta", id: "a", delta: "Working" },
    ] as UIMessageChunk[]);
    const last = ChatCompletionChunkSchema.parse(JSON.parse(out.at(-2) ?? "{}"));
    expect(last.choices[0]?.finish_reason).toBeNull();
    expect(last.magica).toMatchObject({ run_id: "r1", status: "running" });
  });
});
