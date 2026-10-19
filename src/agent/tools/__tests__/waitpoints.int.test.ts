import { randomUUID } from "node:crypto";

import { wait } from "@trigger.dev/sdk";
import type { Tool, ToolExecutionOptions } from "ai";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_TOOLS } from "@/agent/tools";
import { buildTools, type TurnContext } from "@/agent/tools/define";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { chatService } from "@/modules/chats/chat.service";
import { runService } from "@/modules/runs/run.service";
import { waitpointService } from "@/modules/waitpoints/waitpoint.service";

/** What happens while the run waits on the user; each test sets it. Default: nobody answers. */
let whileWaiting: () => Promise<{ ok: boolean }> = () => Promise.resolve({ ok: false });

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: vi.fn((_id: string, p: { runId?: string }) => ({ id: `trig_${p.runId ?? "x"}` })),
  },
  auth: { createPublicToken: vi.fn(() => "pk_test") },
  runs: { cancel: vi.fn() },
  metadata: { set: vi.fn(), del: vi.fn(), flush: vi.fn(() => Promise.resolve()) },
  wait: {
    createToken: vi.fn(() => ({ id: `waitpoint_${randomUUID()}`, url: "https://trigger.test/t" })),
    forToken: vi.fn(() => whileWaiting()),
    completeToken: vi.fn(() => Promise.resolve({ success: true })),
    for: vi.fn(() => Promise.resolve()),
  },
}));

const MAGICA = "https://magica.test/v1";
const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
  whileWaiting = () => Promise.resolve({ ok: false });
});
afterAll(() => {
  server.close();
});

let ctx: TurnContext;
beforeEach(async () => {
  const userId = `user_test_${randomUUID()}`;
  const sent = await chatService.create(userId, randomUUID(), "help", { traceId: "t", logger });
  ctx = { runId: sent.run.runId, chatId: sent.chatId, userId, messageId: sent.assistantMessageId };
  // A run calling tools has been picked up by the worker already.
  await db.agentRun.update({ where: { id: ctx.runId }, data: { status: "working" } });
});

function call(name: string, input: unknown) {
  const tool = buildTools(AGENT_TOOLS, ctx)[name] as Tool<unknown, unknown>;
  const options = { toolCallId: randomUUID(), messages: [] } as unknown as ToolExecutionOptions<
    Record<string, unknown>
  >;
  return tool.execute?.(input, options);
}

/** While the run waits: the user answers its pending question with `response`. */
const userAnswers = (response: unknown) => async () => {
  const waitpoint = await db.waitpoint.findFirstOrThrow({ where: { runId: ctx.runId } });
  await waitpointService.respond(waitpoint.id, ctx.userId, response);
  return { ok: true };
};

const question = { question: "Which style?", options: ["Photo", "Watercolor"] };

describe("ask_user", () => {
  it("pauses the run, shows the question, and returns the user's choice", async () => {
    whileWaiting = async () => {
      // A reload during the wait gets the question back from the run handle.
      const handle = await runService.activeHandle(ctx.chatId);
      expect(handle).toMatchObject({
        status: "waiting",
        waitpoint: { type: "options", status: "pending", request: question },
      });
      return userAnswers({ choice: "Watercolor" })();
    };

    expect(await call("ask_user", question)).toEqual({ choice: "Watercolor" });
    expect(wait.completeToken).toHaveBeenCalledTimes(1);
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: ctx.runId } });
    expect(run.status).toBe("working");
  });

  it("a second answer gets the first one back and doesn't wake the run again", async () => {
    whileWaiting = userAnswers({ choice: "Photo" });
    await call("ask_user", question);
    const waitpoint = await db.waitpoint.findFirstOrThrow({ where: { runId: ctx.runId } });

    const again = await waitpointService.respond(waitpoint.id, ctx.userId, {
      choice: "Watercolor",
    });

    expect(again).toMatchObject({ status: "answered" });
    expect(waitpoint.response).toEqual({ choice: "Photo" });
    expect(wait.completeToken).toHaveBeenCalledTimes(1);
  });

  it("someone else can't answer it (404), and a malformed answer is rejected", async () => {
    whileWaiting = async () => {
      const waitpoint = await db.waitpoint.findFirstOrThrow({ where: { runId: ctx.runId } });
      await expect(
        waitpointService.respond(waitpoint.id, "user_other", { choice: "Photo" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        waitpointService.respond(waitpoint.id, ctx.userId, { choice: "" }),
      ).rejects.toThrow();
      return userAnswers({ choice: "Photo" })();
    };

    expect(await call("ask_user", question)).toEqual({ choice: "Photo" });
  });

  it("nobody answers: it expires, the agent says so, and a late answer is refused", async () => {
    await expect(call("ask_user", question)).rejects.toMatchObject({ code: "WAITPOINT_EXPIRED" });

    const waitpoint = await db.waitpoint.findFirstOrThrow({ where: { runId: ctx.runId } });
    expect(waitpoint.status).toBe("expired");
    await expect(
      waitpointService.respond(waitpoint.id, ctx.userId, { choice: "Photo" }),
    ).rejects.toMatchObject({ code: "WAITPOINT_CLOSED" });
  });
});

describe("Stop", () => {
  it("cancels the pending question and stops waiting at once", async () => {
    const stop = new AbortController();
    ctx = { ...ctx, signal: stop.signal };
    whileWaiting = () => {
      stop.abort();
      return new Promise(() => undefined); // the user never answers
    };

    await expect(call("ask_user", question)).rejects.toMatchObject({ name: "AbortError" });
    const waitpoint = await db.waitpoint.findFirstOrThrow({ where: { runId: ctx.runId } });
    expect(waitpoint.status).toBe("cancelled");
  });
});

describe("propose_plan", () => {
  it("a rejected plan comes back with the user's feedback", async () => {
    whileWaiting = userAnswers({ approved: false, feedback: "Skip the crop" });

    expect(await call("propose_plan", { plan: "1. Generate\n2. Crop" })).toEqual({
      approved: false,
      feedback: "Skip the crop",
    });
  });
});

describe("credit approval", () => {
  /** gpt_image_2 at `estimate` microcredits; counts run creations. */
  function magicaEstimates(estimate: number) {
    const runs: unknown[] = [];
    server.use(
      http.post(`${MAGICA}/nodes/estimate-credits`, () =>
        HttpResponse.json({ estimates: [{ microcredits: estimate }] }),
      ),
      http.post(`${MAGICA}/nodes/gpt_image_2/run`, () => {
        runs.push(1);
        return HttpResponse.json({ runId: `mr_${randomUUID()}` }, { status: 202 });
      }),
    );
    return runs;
  }
  const highQuality = { mode: "text", prompt: "a red apple", quality: "High" };

  it("asks before an expensive run; declining runs nothing and holds no credits", async () => {
    const runs = magicaEstimates(273_936);
    whileWaiting = async () => {
      const waitpoint = await db.waitpoint.findFirstOrThrow({ where: { runId: ctx.runId } });
      expect(waitpoint).toMatchObject({
        type: "credit_approval",
        request: { tool: "gpt_image_2", estimateMicro: 273_936 },
      });
      return userAnswers({ approved: false })();
    };

    await expect(call("gpt_image_2", highQuality)).rejects.toMatchObject({
      code: "APPROVAL_DECLINED",
    });
    expect(runs).toHaveLength(0);
    expect(
      await db.creditLedger.count({ where: { runId: ctx.runId, invocationId: { not: null } } }),
    ).toBe(0);

    // The model retries the same call: declined again without asking the user a second time.
    await expect(call("gpt_image_2", highQuality)).rejects.toMatchObject({
      code: "APPROVAL_DECLINED",
    });
    expect(await db.waitpoint.count({ where: { runId: ctx.runId } })).toBe(1);
    expect(runs).toHaveLength(0);
  });

  it("an unknown cost asks too, and an approved run goes ahead", async () => {
    const runs: unknown[] = [];
    server.use(
      http.post(`${MAGICA}/nodes/estimate-credits`, () =>
        HttpResponse.json({ error: "Internal Server Error" }, { status: 500 }),
      ),
      http.post(`${MAGICA}/nodes/gpt_image_2/run`, () => {
        runs.push(1);
        return HttpResponse.json({ runId: `mr_${randomUUID()}` }, { status: 202 });
      }),
      http.get(`${MAGICA}/nodes/runs/:id`, ({ params }) =>
        HttpResponse.json({
          id: params.id,
          status: "COMPLETED",
          output: { result: ["https://g.tlcdn.com/gen/a.png"] },
          creditUsed: 7_644,
        }),
      ),
    );
    whileWaiting = async () => {
      const waitpoint = await db.waitpoint.findFirstOrThrow({ where: { runId: ctx.runId } });
      expect(waitpoint.request).toMatchObject({ estimateMicro: null });
      return userAnswers({ approved: true })();
    };

    await call("gpt_image_2", { mode: "text", prompt: "a red apple" });
    expect(runs).toHaveLength(1);
  });

  it("a cheap run doesn't ask", async () => {
    magicaEstimates(7_644);
    server.use(
      http.get(`${MAGICA}/nodes/runs/:id`, ({ params }) =>
        HttpResponse.json({
          id: params.id,
          status: "COMPLETED",
          output: { result: ["https://g.tlcdn.com/gen/a.png"] },
          creditUsed: 7_644,
        }),
      ),
    );

    await call("gpt_image_2", { mode: "text", prompt: "a red apple" });
    expect(await db.waitpoint.count({ where: { runId: ctx.runId } })).toBe(0);
  });
});
