import { randomUUID } from "node:crypto";

import { runs, tasks } from "@trigger.dev/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { chatService } from "@/modules/chats/chat.service";
import { creditService, SEED_GRANT_MICRO } from "@/modules/credits/credit.service";
import { runService } from "@/modules/runs/run.service";
import { toolRepository } from "@/modules/tools/tool.repository";

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: vi.fn((_id: string, p: { runId?: string }) => ({ id: `trig_${p.runId ?? "x"}` })),
  },
  auth: { createPublicToken: vi.fn(() => "pk_test") },
  // By default every Trigger.dev run is still going; tests say which ones have died.
  runs: { cancel: vi.fn(), retrieve: vi.fn(() => Promise.resolve({ isCompleted: false })) },
}));

const ctx = { traceId: "t", logger };
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

/**
 * Trigger.dev runs that ended, by id, and when. The test database is shared, so the sweeper also
 * sees other tests' runs: they stay "still going", and tests check their own runs, not totals.
 */
let ended: Map<string, Date>;
let userId: string;
beforeEach(() => {
  userId = `user_test_${randomUUID()}`;
  ended = new Map();
  vi.mocked(runs.retrieve).mockImplementation(((id: string) => {
    const finishedAt = ended.get(id);
    return Promise.resolve({ isCompleted: finishedAt !== undefined, finishedAt });
  }) as never);
});
afterEach(() => {
  vi.clearAllMocks();
});
const diedAt = (sent: { run: { runId: string } }, at = minutesAgo(3)) => {
  ended.set(`trig_${sent.run.runId}`, at);
};

/** A sent chat whose run started `minutes` ago, in `status`. */
async function runFrom(minutes: number, status: "queued" | "working" | "waiting" | "stopping") {
  const sent = await chatService.create(userId, randomUUID(), "hi", ctx);
  await db.agentRun.update({
    where: { id: sent.run.runId },
    data: { status, createdAt: minutesAgo(minutes) },
  });
  return sent;
}

describe("run sweeper", () => {
  it("re-dispatches a run that was never handed to Trigger.dev", async () => {
    const sent = await runFrom(5, "queued");
    await db.agentRun.update({ where: { id: sent.run.runId }, data: { triggerRunId: null } });
    vi.mocked(tasks.trigger).mockClear();

    await runService.sweep(logger);

    expect(tasks.trigger).toHaveBeenCalledWith(
      "agent-turn",
      { runId: sent.run.runId },
      expect.objectContaining({ idempotencyKey: sent.run.runId }),
    );
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: sent.run.runId } });
    expect(run.triggerRunId).toBe(`trig_${sent.run.runId}`);
  });

  it("ends a run whose worker died: STALE, chat freed, question cancelled, credits back", async () => {
    const sent = await runFrom(5, "waiting");
    const call = await toolRepository.start({
      runId: sent.run.runId,
      messageId: sent.assistantMessageId,
      toolCallId: "call-1",
      toolName: "gpt_image_2",
      kind: "media",
      ordinal: 0,
      inputSanitized: {},
    });
    await creditService.reserveTool(
      { userId, runId: sent.run.runId, invocationId: call.id },
      50_000n,
    );
    await db.waitpoint.create({
      data: {
        userId,
        chatId: sent.chatId,
        runId: sent.run.runId,
        toolCallId: "call-1",
        type: "credit_approval",
        request: {},
        tokenId: "tok_1",
        idempotencyKey: `${sent.run.runId}:call-1:credit_approval`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    diedAt(sent);

    await runService.sweep(logger);

    const run = await db.agentRun.findUniqueOrThrow({ where: { id: sent.run.runId } });
    const message = await db.message.findUniqueOrThrow({ where: { id: sent.assistantMessageId } });
    expect(run).toMatchObject({ status: "failed", errorCode: "STALE" });
    expect(message).toMatchObject({ status: "failed", errorCode: "STALE" });
    expect((await db.waitpoint.findFirstOrThrow({ where: { runId: run.id } })).status).toBe(
      "cancelled",
    );
    expect((await toolRepository.get(call.id)).state).toBe("cancelled");
    // The admission reserve and the tool reserve both came back.
    expect(await creditService.balance(userId)).toBe(SEED_GRANT_MICRO);
    // The chat accepts a new message again.
    await expect(
      chatService.send(sent.chatId, userId, randomUUID(), "again", ctx),
    ).resolves.toBeDefined();
  });

  it("a stopped run whose worker died ends cancelled, not failed", async () => {
    const sent = await runFrom(5, "stopping");
    diedAt(sent);

    await runService.sweep(logger);

    const run = await db.agentRun.findUniqueOrThrow({ where: { id: sent.run.runId } });
    expect(run.status).toBe("cancelled");
  });

  it("a run Trigger.dev finished just now is left to save itself (Stop's hook may be saving)", async () => {
    const sent = await runFrom(5, "stopping");
    diedAt(sent, new Date());

    await runService.sweep(logger);
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: sent.run.runId } });
    expect(run.status).toBe("stopping");
  });

  it("leaves live runs and young runs alone", async () => {
    const live = await runFrom(5, "working");
    const young = await runFrom(0, "working");

    await runService.sweep(logger);
    // The young run isn't even checked with Trigger.dev.
    expect(vi.mocked(runs.retrieve).mock.calls.map(([id]) => id)).not.toContain(
      `trig_${young.run.runId}`,
    );

    for (const sent of [live, young]) {
      const run = await db.agentRun.findUniqueOrThrow({ where: { id: sent.run.runId } });
      expect(run.status).toBe("working");
    }
  });
});
