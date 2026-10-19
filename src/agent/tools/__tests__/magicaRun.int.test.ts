import { randomUUID } from "node:crypto";

import { wait } from "@trigger.dev/sdk";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "@/agent/tools/define";
import { runMagicaModel } from "@/agent/tools/magicaRun";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { chatService } from "@/modules/chats/chat.service";
import { toolRepository } from "@/modules/tools/tool.repository";

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: vi.fn((_id: string, p: { runId?: string }) => ({ id: `trig_${p.runId ?? "x"}` })),
  },
  auth: { createPublicToken: vi.fn(() => "pk_test") },
  runs: { cancel: vi.fn() },
  // The webhook "arrives" at once; each test decides what Magica says the run is doing.
  wait: {
    createToken: vi.fn(() => ({ id: "waitpoint_1", url: "https://trigger.test/token/1" })),
    forToken: vi.fn(() => Promise.resolve({ ok: true, output: {} })),
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
});
afterAll(() => {
  server.close();
});

const job = { nodeType: "crop_image", input: { image_url: "https://x.test/a.png" } };
const output = { imageUrl: "https://cdn.magica.test/out.png" };

let ctx: ToolContext;
// Unique per test: magicaRunId is unique across the whole table.
let magicaRunId: string;
beforeEach(async () => {
  magicaRunId = `mr_${randomUUID()}`;
  const userId = `user_test_${randomUUID()}`;
  const sent = await chatService.create(userId, randomUUID(), "crop it", { traceId: "t", logger });
  const call = await toolRepository.start({
    runId: sent.run.runId,
    messageId: sent.assistantMessageId,
    toolCallId: "call-1",
    toolName: "crop_image",
    kind: "media",
    ordinal: 0,
    inputSanitized: job.input,
  });
  ctx = {
    runId: sent.run.runId,
    chatId: sent.chatId,
    userId,
    messageId: sent.assistantMessageId,
    invocationId: call.id,
    toolCallId: call.toolCallId,
    toolName: "crop_image",
  };
});

/** Magica accepts runs as `magicaRunId` and answers status checks with `statuses` in turn (the last repeats). */
function magicaServes(...statuses: object[]) {
  const nextStatus = () => (statuses.length > 1 ? statuses.shift() : statuses[0]);
  const posts: unknown[] = [];
  server.use(
    http.post(`${MAGICA}/nodes/crop_image/run`, async ({ request }) => {
      posts.push(await request.json());
      return HttpResponse.json(
        { runId: magicaRunId, webhook: { signingSecret: "whsec_x" } },
        {
          status: 202,
        },
      );
    }),
    http.get(`${MAGICA}/nodes/runs/${magicaRunId}`, () =>
      HttpResponse.json({ id: magicaRunId, nodeType: "crop_image", ...nextStatus() }),
    ),
  );
  return posts;
}
const savedRunId = async () => (await toolRepository.get(ctx.invocationId)).magicaRunId;

describe("runMagicaModel", () => {
  it("creates the run with the token as webhook, saves its id, and returns the result", async () => {
    const posts = magicaServes({ status: "COMPLETED", output, creditUsed: 1000 });

    const run = await runMagicaModel(job, ctx);

    expect(run).toMatchObject({ id: magicaRunId, status: "COMPLETED", output });
    expect(posts).toEqual([
      {
        input: job.input,
        webhook: {
          url: "https://trigger.test/token/1",
          events: ["run.completed", "run.failed", "run.canceled"],
        },
      },
    ]);
    expect(wait.createToken).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `magica:${ctx.invocationId}` }),
    );
    expect(await savedRunId()).toBe(magicaRunId);
  });

  it("a retried call with a saved run id never creates a second run", async () => {
    await toolRepository.setMagicaRunId(ctx.invocationId, magicaRunId);
    const posts = magicaServes({ status: "COMPLETED", output });

    expect(await runMagicaModel(job, ctx)).toMatchObject({ output });
    expect(posts).toHaveLength(0);
  });

  it("polls when the webhook hasn't come, until the run finishes", async () => {
    magicaServes({ status: "RUNNING" }, { status: "RUNNING" }, { status: "COMPLETED", output });

    expect(await runMagicaModel(job, ctx)).toMatchObject({ output });
    expect(wait.for).toHaveBeenCalledTimes(2);
  });

  it("a failed run is GENERATION_FAILED with Magica's safe reason", async () => {
    magicaServes({ status: "FAILED", userMessage: "The image couldn't be read." });

    await expect(runMagicaModel(job, ctx)).rejects.toMatchObject({
      code: "GENERATION_FAILED",
      message: "The image couldn't be read.",
    });
  });

  it("a run still going after the cap is GENERATION_TIMEOUT", async () => {
    await db.toolInvocation.update({
      where: { id: ctx.invocationId },
      data: { startedAt: new Date(Date.now() - 16 * 60_000) },
    });
    magicaServes({ status: "RUNNING" });

    await expect(runMagicaModel(job, ctx)).rejects.toMatchObject({ code: "GENERATION_TIMEOUT" });
    expect(wait.for).not.toHaveBeenCalled();
  });

  it("a rejected input saves no run id, so the call can be fixed and tried again", async () => {
    server.use(
      http.post(`${MAGICA}/nodes/crop_image/run`, () =>
        HttpResponse.json({ message: "image_url is required" }, { status: 400 }),
      ),
    );

    await expect(runMagicaModel(job, ctx)).rejects.toMatchObject({
      code: "INVALID_TOOL_INPUT",
      message: "image_url is required",
    });
    expect(await savedRunId()).toBeNull();
  });

  it("a busy Magica at create is tried again after its Retry-After", async () => {
    const posts = magicaServes({ status: "COMPLETED", output });
    server.use(
      http.post(
        `${MAGICA}/nodes/crop_image/run`,
        () => HttpResponse.json({}, { status: 429, headers: { "Retry-After": "7" } }),
        { once: true },
      ),
    );

    expect(await runMagicaModel(job, ctx)).toMatchObject({ output });
    expect(wait.for).toHaveBeenCalledWith({ seconds: 7 });
    expect(posts).toHaveLength(1);
  });

  it("a flaky status check doesn't abandon a run Magica is still making", async () => {
    magicaServes({ status: "COMPLETED", output });
    server.use(
      http.get(
        `${MAGICA}/nodes/runs/${magicaRunId}`,
        () => HttpResponse.json({}, { status: 502 }),
        {
          once: true,
        },
      ),
    );

    expect(await runMagicaModel(job, ctx)).toMatchObject({ output });
    expect(await savedRunId()).toBe(magicaRunId);
  });

  it("a failed create is not retried unless Magica said it was busy", async () => {
    let posts = 0;
    server.use(
      http.post(`${MAGICA}/nodes/crop_image/run`, () => {
        posts++;
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    await expect(runMagicaModel(job, ctx)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(posts).toBe(1);
  });

  it("Stop drops the wait at once", async () => {
    magicaServes({ status: "RUNNING" });
    vi.mocked(wait.forToken).mockReturnValueOnce(new Promise(() => undefined) as never);
    const stop = new AbortController();

    const pending = runMagicaModel(job, { ...ctx, signal: stop.signal });
    await vi.waitFor(() => {
      expect(wait.forToken).toHaveBeenCalled();
    });
    stop.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(await savedRunId()).toBe(magicaRunId);
  });
});
