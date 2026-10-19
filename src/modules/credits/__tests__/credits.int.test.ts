import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { chatService } from "@/modules/chats/chat.service";
import { ADMISSION_MICRO, SEED_GRANT_MICRO, creditService } from "@/modules/credits/credit.service";
import { runService } from "@/modules/runs/run.service";
import { toolRepository } from "@/modules/tools/tool.repository";

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: vi.fn((_id: string, p: { runId?: string }) => ({ id: `trig_${p.runId ?? "x"}` })),
  },
  auth: { createPublicToken: vi.fn(() => "pk_test") },
  runs: { cancel: vi.fn() },
}));

const ctx = { traceId: "t", logger };
const newUser = () => `user_test_${randomUUID()}`;
const send = (userId: string) => chatService.create(userId, randomUUID(), "hi", ctx);

/** A tool call in a fresh chat, for reserve/charge tests. */
async function toolCall(userId: string) {
  const sent = await send(userId);
  const row = await toolRepository.start({
    runId: sent.run.runId,
    messageId: sent.assistantMessageId,
    toolCallId: randomUUID(),
    toolName: "gpt_image_2",
    kind: "media",
    ordinal: 0,
    inputSanitized: {},
  });
  return { userId, runId: sent.run.runId, invocationId: row.id };
}

describe("credits", () => {
  it("grants the seed credits once, however often the balance is read", async () => {
    const userId = newUser();

    await creditService.balance(userId);
    expect(await creditService.balance(userId)).toBe(SEED_GRANT_MICRO);
    expect(await db.creditLedger.count({ where: { userId, type: "grant" } })).toBe(1);
  });

  it("a send holds the admission reserve until the turn settles", async () => {
    const userId = newUser();
    const sent = await send(userId);
    expect(await creditService.balance(userId)).toBe(SEED_GRANT_MICRO - ADMISSION_MICRO);

    const run = await db.agentRun.findUniqueOrThrow({ where: { id: sent.run.runId } });
    await runService.settle(run, {
      status: "completed",
      blocks: [],
      text: "",
      metadata: {},
    });

    expect(await creditService.balance(userId)).toBe(SEED_GRANT_MICRO);
  });

  it("an empty balance refuses the send with 402, saving nothing", async () => {
    const userId = newUser();
    await creditService.balance(userId);
    await db.creditAccount.update({ where: { userId }, data: { balanceMicro: 0n } });

    await expect(send(userId)).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    expect(await db.chat.count({ where: { userId } })).toBe(0);
  });

  it("concurrent reserves never overdraw the balance", async () => {
    const userId = newUser();
    // Set up one by one (each is a send transaction); only the reserves race.
    const calls = [await toolCall(userId), await toolCall(userId), await toolCall(userId)];
    // Balance is 1M minus three admissions (0.97M): only two 0.4M reserves fit.
    const results = await Promise.allSettled(
      calls.map((call) => creditService.reserveTool(call, 400_000n)),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await creditService.balance(userId)).toBe(
      SEED_GRANT_MICRO - 3n * ADMISSION_MICRO - 800_000n,
    );
  }, 60_000); // three sends to set up: slow when Neon is far away

  it("a replayed charge charges once, and the turn's total lands on its message", async () => {
    const userId = newUser();
    const call = await toolCall(userId);
    await creditService.reserveTool(call, 10_000n);
    await creditService.chargeTool(call, 7_644n);
    await creditService.chargeTool(call, 7_644n);

    expect(await creditService.chargedForRun(call.runId)).toBe(7_644n);

    const run = await db.agentRun.findUniqueOrThrow({ where: { id: call.runId } });
    await runService.settle(run, { status: "completed", blocks: [], text: "", metadata: {} });
    const message = await db.message.findUniqueOrThrow({ where: { id: run.assistantMessageId } });
    expect(message.metadata).toMatchObject({ creditsUsedMicro: 7_644 });
    expect(await creditService.balance(userId)).toBe(SEED_GRANT_MICRO - 7_644n);

    // The /usage page groups it under the tool that spent it.
    expect(await creditService.usage(userId)).toMatchObject({
      debitedMicro: 7_644,
      executions: 1,
      tools: [{ tool: "gpt_image_2", debitedMicro: 7_644, executions: 1 }],
    });
    const charges = await creditService.toolCharges(userId, "gpt_image_2", 20);
    expect(charges.items.map((entry) => entry.amountMicro)).toEqual([-7_644n]);
  });
});
