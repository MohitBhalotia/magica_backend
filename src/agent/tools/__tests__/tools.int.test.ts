import { randomUUID } from "node:crypto";

import type { Tool, ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_TOOLS } from "@/agent/tools";
import { buildTools, type TurnContext } from "@/agent/tools/define";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { chatService } from "@/modules/chats/chat.service";

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: vi.fn((_id: string, p: { runId?: string }) => ({ id: `trig_${p.runId ?? "x"}` })),
  },
  auth: { createPublicToken: vi.fn(() => "pk_test") },
  runs: { cancel: vi.fn() },
}));

let ctx: TurnContext;
beforeEach(async () => {
  const userId = `user_test_${randomUUID()}`;
  const sent = await chatService.create(userId, randomUUID(), "crop my photo", {
    traceId: "t",
    logger,
  });
  ctx = {
    runId: sent.run.runId,
    chatId: sent.chatId,
    userId,
    messageId: sent.assistantMessageId,
  };
});

/** Calls one tool the way the AI SDK does: validated input plus the call's id. */
function call(name: string, input: unknown, toolCallId: string = randomUUID()) {
  const tool = buildTools(AGENT_TOOLS, ctx)[name] as Tool<unknown, unknown>;
  const options = { toolCallId, messages: [] } as unknown as ToolExecutionOptions<
    Record<string, unknown>
  >;
  return tool.execute?.(input, options);
}
const rows = () =>
  db.toolInvocation.findMany({ where: { runId: ctx.runId }, orderBy: { startedAt: "asc" } });

describe("load_skill", () => {
  it("returns the instructions once per run and records each call", async () => {
    const first = await call("load_skill", { name: "crop-image" });
    const again = await call("load_skill", { name: "crop-image" });

    expect(first).toMatchObject({ name: "crop-image", alreadyLoaded: false });
    expect((first as { instructions: string }).instructions).toContain("crop_image");
    expect(again).toMatchObject({ name: "crop-image", alreadyLoaded: true });
    expect(await db.runSkill.count({ where: { runId: ctx.runId } })).toBe(1);
    expect((await rows()).map((r) => [r.toolName, r.kind, r.state])).toEqual([
      ["load_skill", "skill", "succeeded"],
      ["load_skill", "skill", "succeeded"],
    ]);
  });

  it("a retried step (same toolCallId) gets the saved output without running again", async () => {
    const first = await call("load_skill", { name: "video-merge" }, "call-1");
    const replay = await call("load_skill", { name: "video-merge" }, "call-1");

    expect(replay).toEqual(first);
    expect(await rows()).toHaveLength(1);
  });

  it("an unknown skill is a safe tool error, saved on the call", async () => {
    await expect(call("load_skill", { name: "rm-rf" })).rejects.toMatchObject({
      code: "INVALID_TOOL_INPUT",
      message: expect.stringContaining("Available:") as unknown,
    });
    expect(await rows()).toMatchObject([{ state: "failed", errorCode: "INVALID_TOOL_INPUT" }]);
  });
});

describe("read_skill_asset", () => {
  it("refuses a path outside the skill", async () => {
    await expect(
      call("read_skill_asset", { skill: "crop-image", path: "../../.env.local" }),
    ).rejects.toMatchObject({ code: "INVALID_TOOL_INPUT" });
    expect(await rows()).toMatchObject([{ toolName: "read_skill_asset", state: "failed" }]);
  });

  it("reads a file the skill lists", async () => {
    expect(await call("read_skill_asset", { skill: "crop-image", path: "SKILL.md" })).toMatchObject(
      {
        path: "SKILL.md",
        text: expect.stringContaining("name: crop-image") as unknown,
      },
    );
  });
});
