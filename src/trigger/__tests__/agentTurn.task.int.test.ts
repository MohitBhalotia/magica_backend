import { randomUUID } from "node:crypto";

import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { chatService } from "@/modules/chats/chat.service";
import { agentTurn } from "@/trigger/agentTurn.task";

const mocks = vi.hoisted(() => ({ doStream: vi.fn() }));

vi.mock("@trigger.dev/sdk", () => ({
  // A task is its config here, so the test can call `run` directly.
  schemaTask: (config: object) => ({ ...config, trigger: vi.fn(() => Promise.resolve({})) }),
  // Realtime stand-in: reads the whole stream, like the real pipe does.
  streams: {
    define: () => ({
      pipe: (stream: ReadableStream) => ({
        waitUntilComplete: async () => {
          const reader = stream.getReader();
          while (!(await reader.read()).done);
        },
      }),
    }),
  },
  logger: { error: vi.fn(), warn: vi.fn() },
  tasks: { trigger: vi.fn((_id: string, p: { runId: string }) => ({ id: `trig_${p.runId}` })) },
  auth: { createPublicToken: vi.fn(() => "pk_test") },
  runs: { cancel: vi.fn() },
}));

vi.mock("@/providers/openrouter", () => ({
  openRouterFree: () => new MockLanguageModelV4({ doStream: mocks.doStream }),
}));

type Run = (payload: { runId: string }, ctx: { signal: AbortSignal }) => Promise<unknown>;
const run = (agentTurn as unknown as { run: Run }).run;

const answer = (text: string) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "text-start" as const, id: "t" },
      { type: "text-delta" as const, id: "t", delta: text },
      { type: "text-end" as const, id: "t" },
      {
        type: "finish" as const,
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 2, text: 2, reasoning: undefined },
        },
      },
    ],
  }),
});

const send = () =>
  chatService.create(`user_test_${randomUUID()}`, randomUUID(), "hello", {
    traceId: "t",
    logger,
  });
const turn = (runId: string, signal = new AbortController().signal) => run({ runId }, { signal });
const reply = (id: string) => db.message.findUniqueOrThrow({ where: { id } });
const runRow = (id: string) => db.agentRun.findUniqueOrThrow({ where: { id } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agent-turn", () => {
  it("answers and saves the message and run", async () => {
    mocks.doStream.mockResolvedValue(answer("Hi there"));
    const sent = await send();

    expect(await turn(sent.run.runId)).toEqual({ status: "completed" });

    expect(await reply(sent.assistantMessageId)).toMatchObject({
      status: "success",
      text: "Hi there",
      contentBlocks: [{ type: "step-start" }, { type: "text", text: "Hi there", state: "done" }],
      tokenUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
    expect(await runRow(sent.run.runId)).toMatchObject({ status: "completed" });
  });

  it("a provider failure saves a safe error and fails the task", async () => {
    mocks.doStream.mockRejectedValue(
      new APICallError({
        message: "invalid key sk-or-secret",
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 401,
      }),
    );
    const sent = await send();

    await expect(turn(sent.run.runId)).rejects.toMatchObject({ code: "PROVIDER_AUTH" });

    const saved = await reply(sent.assistantMessageId);
    expect(saved).toMatchObject({ status: "failed", errorCode: "PROVIDER_AUTH" });
    expect(saved.errorMessage).not.toContain("sk-or");
    expect(await runRow(sent.run.runId)).toMatchObject({ status: "failed" });
  });

  it("a stopped turn is saved as cancelled without failing the task", async () => {
    mocks.doStream.mockResolvedValue(answer("Partial"));
    const sent = await send();
    const controller = new AbortController();
    controller.abort();

    expect(await turn(sent.run.runId, controller.signal)).toEqual({ status: "cancelled" });
    expect(await reply(sent.assistantMessageId)).toMatchObject({ status: "cancelled" });
  });

  it("skips a run that has already ended", async () => {
    mocks.doStream.mockResolvedValue(answer("Hi"));
    const sent = await send();
    await turn(sent.run.runId);

    expect(await turn(sent.run.runId)).toEqual({ status: "skipped" });
    expect(mocks.doStream).toHaveBeenCalledOnce();
  });
});
