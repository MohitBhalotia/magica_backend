import { beforeEach, describe, expect, it, vi } from "vitest";

import { runTool } from "@/modules/tools/tool.controller";

const mock = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: () => Promise.resolve("user_1") }));
vi.mock("@/lib/rateLimiter", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("@/modules/chats/chat.service", () => ({
  chatService: { create: mock.create, send: mock.send },
}));

const sent = {
  chatId: "c1",
  userMessageId: "m1",
  assistantMessageId: "m2",
  run: {
    runId: "r1",
    status: "queued",
    triggerRunId: "t1",
    publicAccessToken: null,
    waitpoint: null,
  },
};
const call = (tool: string, body: unknown) =>
  runTool(
    new Request(`http://api.test/api/v1/tools/${tool}/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tool }) },
  );
const crop = { image_url: "https://x.test/a.png", width_percent: 50, height_percent: 50 };

beforeEach(() => {
  vi.clearAllMocks();
  mock.create.mockResolvedValue(sent);
  mock.send.mockResolvedValue(sent);
});

describe("POST /tools/{tool}/run", () => {
  it("starts a direct run of the tool with the caller's input: 202 and the run", async () => {
    const res = await call("crop_image", { input: crop });

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ chatId: "c1", run: { runId: "r1" } });
    expect(mock.create).toHaveBeenCalledWith(
      "user_1",
      expect.any(String),
      expect.stringContaining("Run crop_image"),
      expect.anything(),
      [],
      { tool: "crop_image", input: crop },
    );
  });

  it("chat_id runs it in that chat", async () => {
    await call("crop_image", { input: crop, chat_id: "c9" });
    expect(mock.send.mock.calls[0]?.[0]).toBe("c9");
  });

  it("a bad input is INVALID_TOOL_INPUT and starts nothing", async () => {
    const res = await call("crop_image", { input: { image_url: "not a url" } });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_TOOL_INPUT" } });
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("only the Magica tools: anything else is NOT_FOUND", async () => {
    for (const tool of ["load_skill", "ask_user", "nope"]) {
      const res = await call(tool, { input: {} });
      expect(res.status).toBe(404);
    }
    expect(mock.create).not.toHaveBeenCalled();
  });
});
