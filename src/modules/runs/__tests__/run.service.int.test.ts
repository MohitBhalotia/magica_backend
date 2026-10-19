import { randomUUID } from "node:crypto";

import { runs, tasks } from "@trigger.dev/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import type { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { chatRepository } from "@/modules/chats/chat.repository";
import { chatService } from "@/modules/chats/chat.service";
import { runRepository } from "@/modules/runs/run.repository";
import { runService } from "@/modules/runs/run.service";

const { fakeTrigger } = vi.hoisted(() => ({
  fakeTrigger: (_id: string, p: { runId?: string }) => Promise.resolve({ id: `trig_${p.runId}` }),
}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: vi.fn(fakeTrigger) },
  auth: { createPublicToken: vi.fn(() => "pk_test") },
  runs: { cancel: vi.fn(), retrieve: vi.fn() },
}));

const newUser = () => `user_test_${randomUUID()}`;
const ctx = { traceId: "t", logger };
const first = (userId: string) => chatService.create(userId, randomUUID(), "hello", ctx);
const followUp = (chatId: string, userId: string) =>
  chatService.send(chatId, userId, randomUUID(), "and then?", ctx);
const finish = (runId: string, status: "completed" | "failed" | "cancelled") =>
  db.agentRun.update({ where: { id: runId }, data: { status } });
const code = (c: string) => expect.objectContaining({ code: c }) as unknown as AppError;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("send", () => {
  it("dispatches agent-turn once per run with the run id as idempotency key", async () => {
    const user = newUser();
    const sent = await first(user);
    expect(tasks.trigger).toHaveBeenCalledWith(
      "agent-turn",
      { runId: sent.run.runId },
      expect.objectContaining({ idempotencyKey: sent.run.runId, concurrencyKey: user }),
    );
    expect(sent.run.triggerRunId).toBe(`trig_${sent.run.runId}`);
  });

  it("starts chat-title with the first message only, keyed by chat id", async () => {
    const user = newUser();
    const clientMessageId = randomUUID();
    const sent = await chatService.create(user, clientMessageId, "hello", ctx);
    await chatService.create(user, clientMessageId, "hello", ctx); // replay: same key, one run
    await finish(sent.run.runId, "completed");
    await followUp(sent.chatId, user);
    const title = [
      "chat-title",
      { chatId: sent.chatId },
      expect.objectContaining({ idempotencyKey: `title:${sent.chatId}` }),
    ];
    const calls = vi.mocked(tasks.trigger).mock.calls.filter(([id]) => id === "chat-title");
    expect(calls).toEqual([title, title]);
  });

  it("still sends when chat-title can't be started", async () => {
    const trigger = vi.mocked(tasks.trigger);
    trigger.mockImplementation(((id: string, p: { runId?: string }) =>
      id === "chat-title"
        ? Promise.reject(new Error("trigger down"))
        : fakeTrigger(id, p)) as never);
    try {
      const sent = await first(newUser());
      expect(sent.run.triggerRunId).toBe(`trig_${sent.run.runId}`);
      expect(trigger).toHaveBeenCalledWith("chat-title", expect.anything(), expect.anything());
    } finally {
      trigger.mockImplementation(fakeTrigger as never);
    }
  });

  it("a follow-up while a reply is running is RUN_ACTIVE and stores nothing", async () => {
    const user = newUser();
    const { chatId, run } = await first(user);
    await expect(followUp(chatId, user)).rejects.toEqual(code("RUN_ACTIVE"));
    const { messages, activeRun } = await chatService.get(chatId, user);
    expect(messages.items).toHaveLength(2); // no orphan user message
    expect(activeRun?.runId).toBe(run.runId);
  });

  it("a follow-up after the reply finished starts a new run", async () => {
    const user = newUser();
    const sent = await first(user);
    await finish(sent.run.runId, "completed");
    const next = await followUp(sent.chatId, user);
    expect(next.run.runId).not.toBe(sent.run.runId);
    expect((await chatService.get(sent.chatId, user)).messages.items).toHaveLength(4);
  });

  it("leaves the run queued when dispatch fails, and a replay dispatches it", async () => {
    const user = newUser();
    const clientMessageId = randomUUID();
    vi.mocked(tasks.trigger).mockRejectedValueOnce(new Error("trigger down"));
    const failed = await chatService.create(user, clientMessageId, "hi", ctx);
    expect(failed.run).toMatchObject({
      status: "queued",
      triggerRunId: null,
      publicAccessToken: null,
    });
    const replay = await chatService.create(user, clientMessageId, "hi", ctx);
    expect(replay.run).toMatchObject({
      runId: failed.run.runId,
      triggerRunId: `trig_${failed.run.runId}`,
    });
  });
});

describe("cancel", () => {
  it("a dispatched run moves to stopping and Trigger.dev is told to cancel it", async () => {
    const user = newUser();
    const { run } = await first(user);
    const stopped = await runService.cancel(run.runId, user, ctx);
    expect(stopped.status).toBe("stopping");
    expect(runs.cancel).toHaveBeenCalledWith(run.triggerRunId);
  });

  it("a stopped run whose worker died is ended on the next read, unlocking the chat", async () => {
    const user = newUser();
    const { run, chatId } = await first(user);
    await runService.cancel(run.runId, user, ctx);

    // The worker is still saving: the run stays stopping.
    vi.mocked(runs.retrieve).mockResolvedValueOnce({ isCompleted: false } as never);
    expect(await runService.activeHandle(chatId)).toMatchObject({ status: "stopping" });

    // Trigger.dev says the task is over, but nothing settled the run (a crash).
    vi.mocked(runs.retrieve).mockResolvedValueOnce({ isCompleted: true } as never);
    expect(await runService.activeHandle(chatId)).toBeNull();
    const { messages } = await chatService.get(chatId, user);
    expect(messages.items[0]).toMatchObject({ status: "cancelled", runId: run.runId });
    await expect(followUp(chatId, user)).resolves.toMatchObject({ chatId });
  });

  it("an undispatched run is cancelled right away; cancelling again is a no-op", async () => {
    const user = newUser();
    vi.mocked(tasks.trigger).mockRejectedValueOnce(new Error("trigger down"));
    const { run, chatId } = await first(user);
    expect((await runService.cancel(run.runId, user, ctx)).status).toBe("cancelled");
    expect((await runService.cancel(run.runId, user, ctx)).status).toBe("cancelled");
    expect(runs.cancel).not.toHaveBeenCalled();
    // The stopped reply points at its run, so the chat can offer Retry.
    const { messages } = await chatService.get(chatId, user);
    expect(messages.items[0]?.runId).toBe(run.runId);
  });
});

describe("retry", () => {
  it("retries the latest failed reply with a new run on the same user message", async () => {
    const user = newUser();
    const sent = await first(user);
    await finish(sent.run.runId, "failed");
    const retried = await runService.retry(sent.run.runId, user, ctx);
    expect(retried.userMessageId).toBe(sent.userMessageId);
    expect(retried.run.runId).not.toBe(sent.run.runId);
    expect(retried.assistantMessageId).not.toBe(sent.assistantMessageId);
  });

  it("refuses a completed reply, or one that isn't the latest", async () => {
    const user = newUser();
    const sent = await first(user);
    await finish(sent.run.runId, "completed");
    await expect(runService.retry(sent.run.runId, user, ctx)).rejects.toEqual(
      code("VALIDATION_FAILED"),
    );
    const next = await followUp(sent.chatId, user);
    await finish(next.run.runId, "failed");
    await finish(sent.run.runId, "failed");
    await expect(runService.retry(sent.run.runId, user, ctx)).rejects.toEqual(
      code("VALIDATION_FAILED"),
    );
  });
});

describe("worker", () => {
  const answer = {
    blocks: [{ type: "text" as const, text: "Hi there" }],
    text: "Hi there",
    metadata: { thinkingMs: 1200 },
  };
  const begin = async (runId: string) => {
    const run = await runRepository.begin(runId);
    if (!run) throw new Error("expected an active run");
    return run;
  };

  it("picks up a queued run, settles it once and frees the chat", async () => {
    const user = newUser();
    const sent = await first(user);
    const run = await begin(sent.run.runId);
    expect(run.status).toBe("thinking");

    expect(await runService.settle(run, { ...answer, status: "completed" })).toBe(true);
    expect(await runService.settle(run, { ...answer, status: "failed" })).toBe(false);

    const reply = await db.message.findUniqueOrThrow({ where: { id: sent.assistantMessageId } });
    expect(reply).toMatchObject({
      status: "success",
      text: "Hi there",
      runId: run.id,
      metadata: { thinkingMs: 1200 },
    });
    expect(await runRepository.begin(sent.run.runId)).toBeNull();
    expect(await chatRepository.history(sent.chatId, 20)).toEqual([
      { role: "user", text: "hello", attachments: [] },
      { role: "assistant", text: "Hi there", attachments: [] },
    ]);
    await expect(followUp(sent.chatId, user)).resolves.toBeDefined();
  });

  it("a stopped run keeps its partial answer as cancelled", async () => {
    const user = newUser();
    const sent = await first(user);
    const run = await begin(sent.run.runId);
    await runService.cancel(sent.run.runId, user, ctx);

    await runService.settle(run, { ...answer, status: "cancelled" });
    const reply = await db.message.findUniqueOrThrow({ where: { id: sent.assistantMessageId } });
    expect(reply).toMatchObject({ status: "cancelled", text: "Hi there" });
    expect(await chatRepository.history(sent.chatId, 20)).toHaveLength(1); // not in context
  });
});

describe("ownership", () => {
  it("someone else's chat or run is NOT_FOUND", async () => {
    const [owner, other] = [newUser(), newUser()];
    const { chatId, run } = await first(owner);
    await expect(followUp(chatId, other)).rejects.toEqual(code("NOT_FOUND"));
    await expect(runService.cancel(run.runId, other, ctx)).rejects.toEqual(code("NOT_FOUND"));
    await expect(runService.retry(run.runId, other, ctx)).rejects.toEqual(code("NOT_FOUND"));
  });
});
