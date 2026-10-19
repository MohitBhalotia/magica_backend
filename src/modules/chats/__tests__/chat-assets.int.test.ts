import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import { chatService } from "@/modules/chats/chat.service";
import { toolRepository } from "@/modules/tools/tool.repository";

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: vi.fn((_id: string, p: { runId?: string }) => ({ id: `trig_${p.runId ?? "x"}` })),
  },
  auth: { createPublicToken: vi.fn(() => "pk_test") },
  runs: { cancel: vi.fn() },
}));

/** A chat whose reply made `count` images through one gpt_image_2 call. */
async function chatWithImages(count: number) {
  const userId = `user_test_${randomUUID()}`;
  const sent = await chatService.create(userId, randomUUID(), "draw", { traceId: "t", logger });
  const call = await toolRepository.start({
    runId: sent.run.runId,
    messageId: sent.assistantMessageId,
    toolCallId: "call-1",
    toolName: "gpt_image_2",
    kind: "media",
    ordinal: 0,
    inputSanitized: {},
  });
  await toolRepository.saveAssets(
    call.id,
    Array.from({ length: count }, (_, i) => ({
      userId,
      chatId: sent.chatId,
      messageId: sent.assistantMessageId,
      kind: "image" as const,
      url: `https://g.tlcdn.com/gen/${String(i)}.png`,
      mimeType: "image/png",
      sizeBytes: 1_409_305n,
      prompt: "a red apple",
      model: "gpt-image-2-text",
    })),
  );
  return { userId, chatId: sent.chatId };
}

describe("chatService.assets", () => {
  it("pages through the chat's files with no gaps or duplicates", async () => {
    const { userId, chatId } = await chatWithImages(3);

    const first = await chatService.assets(chatId, userId, 2);
    const second = await chatService.assets(chatId, userId, 2, first.nextCursor ?? undefined);

    expect(first.items).toHaveLength(2);
    expect(second).toMatchObject({ nextCursor: null });
    const urls = [...first.items, ...second.items].map((asset) => asset.url);
    expect(new Set(urls).size).toBe(3);
  });

  it("someone else's chat is NOT_FOUND", async () => {
    const { chatId } = await chatWithImages(1);

    await expect(chatService.assets(chatId, "user_other", 20)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
