import { randomUUID } from "node:crypto";

import type { Tool, ToolExecutionOptions } from "ai";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
});
afterAll(() => {
  server.close();
});

let ctx: TurnContext;
beforeEach(async () => {
  const userId = `user_test_${randomUUID()}`;
  const sent = await chatService.create(userId, randomUUID(), "make me something", {
    traceId: "t",
    logger,
  });
  ctx = { runId: sent.run.runId, chatId: sent.chatId, userId, messageId: sent.assistantMessageId };
});

function call(name: string, input: unknown) {
  const tool = buildTools(AGENT_TOOLS, ctx)[name] as Tool<unknown, unknown>;
  const options = { toolCallId: randomUUID(), messages: [] } as unknown as ToolExecutionOptions<
    Record<string, unknown>
  >;
  return tool.execute?.(input, options);
}

/** Magica runs `nodeType` and completes it with `output` (taken from real runs in docs/research). */
function magicaCompletes(nodeType: string, output: object, creditUsed: number) {
  const runId = `mr_${randomUUID()}`;
  const posts: unknown[] = [];
  server.use(
    http.post(`${MAGICA}/nodes/${nodeType}/run`, async ({ request }) => {
      posts.push(await request.json());
      return HttpResponse.json({ runId }, { status: 202 });
    }),
    http.get(`${MAGICA}/nodes/runs/${runId}`, () =>
      HttpResponse.json({ id: runId, nodeType, status: "COMPLETED", output, creditUsed }),
    ),
  );
  return posts as { input: Record<string, unknown>; subModelId?: string }[];
}
const assets = () =>
  db.asset.findMany({ where: { chatId: ctx.chatId }, orderBy: { createdAt: "asc" } });

describe("gpt_image_2", () => {
  const output = {
    result: ["https://g.tlcdn.com/gen/67ced02bcd3f42cd805ac26fd61ced0b.png"],
    provider: "fal",
    creditUsed: 7644,
    resultMetadata: [{ size: 1409305, width: 1024, height: 1024, mimeType: "image/png" }],
  };

  it("picks the text sub-model, defaults to Low quality, and saves the image", async () => {
    const posts = magicaCompletes("gpt_image_2", output, 7644);

    const result = await call("gpt_image_2", { mode: "text", prompt: "a red apple" });

    expect(posts).toMatchObject([
      { subModelId: "gpt-image-2-text", input: { prompt: "a red apple", quality: "Low" } },
    ]);
    expect(posts[0]?.input).not.toHaveProperty("mode");
    expect(result).toEqual({
      assets: [
        { kind: "image", url: output.result[0], mimeType: "image/png", width: 1024, height: 1024 },
      ],
      creditUsed: 7644,
    });
    expect(await assets()).toMatchObject([
      { kind: "image", url: output.result[0], prompt: "a red apple", model: "gpt-image-2-text" },
    ]);
  });

  it("edit mode needs images", async () => {
    await expect(call("gpt_image_2", { mode: "edit", prompt: "make it green" })).rejects.toThrow(
      "Edit mode needs uploadedImages",
    );
  });
});

describe("crop_image", () => {
  const output = {
    width: 86,
    height: 89,
    image_url: "https://g.tlcdn.com/gen/07fcd932ce4e4721b4b10d7ff68b439a.png",
    creditUsed: 5000,
  };

  it("crops by percent and saves the result", async () => {
    magicaCompletes("crop_image", output, 5000);

    const result = await call("crop_image", {
      image_url: "https://x.test/a.jpg",
      width_percent: 50,
      height_percent: 50,
    });

    expect(result).toMatchObject({
      assets: [{ kind: "image", url: output.image_url, mimeType: "image/png", width: 86 }],
    });
    expect(await assets()).toMatchObject([{ model: "crop_image", prompt: null }]);
  });

  it.each([
    ["mixed forms", { x_percent: 10, width_px: 100, height_px: 100 }],
    ["a pixel form without height_px", { width_px: 100 }],
  ])("refuses %s", async (_case: string, rect: object) => {
    await expect(
      call("crop_image", { image_url: "https://x.test/a.jpg", ...rect }),
    ).rejects.toThrow("Use exactly one form");
  });

  it("refuses non-HTTPS images", async () => {
    await expect(
      call("crop_image", { image_url: "http://x.test/a.jpg", width_percent: 50 }),
    ).rejects.toThrow();
  });
});

describe("merge_videos", () => {
  it("merges in order and saves the video with its duration", async () => {
    const videos = ["https://x.test/1.mp4", "https://x.test/2.mp4"];
    const posts = magicaCompletes(
      "merge_videos",
      {
        fps: 29.97,
        width: 640,
        format: "mp4",
        height: 360,
        duration: 20.022,
        fileSize: 1750013,
        mimeType: "video/mp4",
        video_url: "https://g.tlcdn.com/gen/35a7dee4fb5d4c1ba8957ffd1d57feca.mp4",
        creditUsed: 16685,
      },
      16685,
    );

    const result = await call("merge_videos", { video_urls: videos });

    expect(posts).toMatchObject([{ input: { video_urls: videos, transition: "none" } }]);
    expect(result).toMatchObject({
      assets: [{ kind: "video", mimeType: "video/mp4", durationMs: 20022, width: 640 }],
      creditUsed: 16685,
    });
    expect(await assets()).toMatchObject([{ kind: "video", durationMs: 20022 }]);
  });

  it("an unreadable result is GENERATION_FAILED, with no assets saved", async () => {
    magicaCompletes("merge_videos", { unexpected: true }, 0);

    await expect(
      call("merge_videos", { video_urls: ["https://x.test/1.mp4", "https://x.test/2.mp4"] }),
    ).rejects.toMatchObject({ code: "GENERATION_FAILED" });
    expect(await assets()).toHaveLength(0);
  });
});
