import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import type { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { chatService, PROMPT_TITLE_LENGTH } from "@/modules/chats/chat.service";

// No real Trigger.dev calls: dispatch returns a fake run id, tokens are fixed.
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: vi.fn((_id: string, p: { runId: string }) => ({ id: `trig_${p.runId}` })) },
  auth: { createPublicToken: vi.fn(() => "pk_test") },
  runs: { cancel: vi.fn() },
}));

// Each test uses fresh user ids, so tests are independent of each other and of copied data.
const newUser = () => `user_test_${randomUUID()}`;
const ctx = { traceId: "t", logger };
const send = (userId: string, text = "Make a logo for my bakery") =>
  chatService.create(userId, randomUUID(), text, ctx);
const notFound = expect.objectContaining({ code: "NOT_FOUND" }) as unknown as AppError;

describe("create", () => {
  it("creates the chat, the first message and the reply placeholder, titled from the prompt", async () => {
    const user = newUser();
    const sent = await send(user, `${"x".repeat(80)} tail`);
    const { chat, messages } = await chatService.get(sent.chatId, user);
    expect(chat).toMatchObject({ titleSource: "prompt" });
    expect(chat.title.length).toBeLessThanOrEqual(PROMPT_TITLE_LENGTH);
    // Newest first: the assistant placeholder, then the user's message.
    expect(messages.items.map((m) => [m.role, m.status])).toEqual([
      ["assistant", "streaming"],
      ["user", "success"],
    ]);
    expect(sent.run).toMatchObject({ status: "queued", publicAccessToken: "pk_test" });
  });

  it("is idempotent: retrying the same clientMessageId returns the same rows and run", async () => {
    const user = newUser();
    const clientMessageId = randomUUID();
    const first = await chatService.create(user, clientMessageId, "hello", ctx);
    const retry = await chatService.create(user, clientMessageId, "hello", ctx);
    expect(retry).toEqual(first);
    expect((await chatService.get(first.chatId, user)).messages.items).toHaveLength(2);
  });

  it("concurrent first sends with the same clientMessageId share one chat, message and run", async () => {
    const user = newUser();
    const clientMessageId = randomUUID();
    const [a, b] = await Promise.all([
      chatService.create(user, clientMessageId, "hello", ctx),
      chatService.create(user, clientMessageId, "hello", ctx),
    ]);
    expect(b.run.runId).toBe(a.run.runId);
    expect(b.userMessageId).toBe(a.userMessageId);
    expect(await db.agentRun.count({ where: { chatId: a.chatId } })).toBe(1);
    expect((await chatService.get(a.chatId, user)).messages.items).toHaveLength(2);
  });
});

describe("get", () => {
  it("pages messages newest first: the next page is older, with no overlap", async () => {
    const user = newUser();
    const { chatId } = await send(user);
    // 55 older messages, one second apart, so the chat has 57 (two pages of 50).
    const start = Date.now() - 3_600_000;
    await db.message.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        chatId,
        userId: user,
        role: "user" as const,
        status: "success" as const,
        text: `old ${String(i)}`,
        createdAt: new Date(start + i * 1000),
      })),
    });

    const first = (await chatService.get(chatId, user)).messages;
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe(first.items.at(-1)?.id);
    const second = (await chatService.get(chatId, user, first.nextCursor ?? undefined)).messages;
    expect(second.items).toHaveLength(7);
    expect(second.nextCursor).toBeNull();
    const oldestOnFirst = first.items.at(-1)?.createdAt ?? new Date();
    expect(second.items.every((m) => m.createdAt <= oldestOnFirst)).toBe(true);
    const ids = [...first.items, ...second.items].map((m) => m.id);
    expect(new Set(ids).size).toBe(57);
  });
});

describe("list", () => {
  it("pages pinned-first then newest-first with no gaps or duplicates", async () => {
    const user = newUser();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await send(user, `chat ${String(i)}`)).chatId);
    await chatService.update(ids[0] ?? "", user, { isPinned: true });

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await chatService.list(user, 2, cursor);
      seen.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toEqual([ids[0], ids[4], ids[3], ids[2], ids[1]]);
  });

  it("only returns the caller's chats", async () => {
    const [mine, theirs] = [newUser(), newUser()];
    await send(theirs);
    expect((await chatService.list(mine, 20)).items).toEqual([]);
  });
});

describe("update", () => {
  it("renames (titleSource=user) and pins without changing updatedAt", async () => {
    const user = newUser();
    const { chatId } = await send(user);
    const before = (await chatService.get(chatId, user)).chat;
    const after = await chatService.update(chatId, user, { title: "Bakery logo", isPinned: true });
    expect(after).toMatchObject({ title: "Bakery logo", titleSource: "user", isPinned: true });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});

describe("remove and duplicate", () => {
  it("soft-deleted chats disappear from list and get", async () => {
    const user = newUser();
    const { chatId } = await send(user);
    await chatService.remove(chatId, user);
    expect((await chatService.list(user, 20)).items).toEqual([]);
    await expect(chatService.get(chatId, user)).rejects.toEqual(notFound);
  });

  it("duplicates the chat and its settled messages (not a reply still being written)", async () => {
    const user = newUser();
    const { chatId } = await send(user, "first prompt");
    const copy = await chatService.duplicate(chatId, user);
    expect(copy.title).toBe("first prompt - Copy");
    const { messages } = await chatService.get(copy.id, user);
    expect(messages.items.map((m) => m.text)).toEqual(["first prompt"]);
  });
});

describe("ownership", () => {
  it("returns NOT_FOUND for every action on someone else's chat", async () => {
    const [owner, other] = [newUser(), newUser()];
    const { chatId } = await send(owner);
    await expect(chatService.get(chatId, other)).rejects.toEqual(notFound);
    await expect(chatService.update(chatId, other, { isPinned: true })).rejects.toEqual(notFound);
    await expect(chatService.remove(chatId, other)).rejects.toEqual(notFound);
    await expect(chatService.duplicate(chatId, other)).rejects.toEqual(notFound);
  });
});

describe("search", () => {
  it("matches titles and message text case-insensitively, only the caller's live chats", async () => {
    const [user, other] = [newUser(), newUser()];
    const byTitle = (await send(user, "Bakery LOGO ideas")).chatId;
    // Renamed, so only its message text matches.
    const byMessage = (await send(user, "design a minimalist logo for my coffee brand")).chatId;
    await chatService.update(byMessage, user, { title: "Coffee" });
    await send(user, "nothing relevant");
    await chatService.remove((await send(user, "logo to delete")).chatId, user);
    await send(other, "their logo");

    const { items } = await chatService.search(user, "logo", 20);
    expect(items.map((c) => c.id)).toEqual([byMessage, byTitle]); // newest first
    expect(items[0]?.messages[0]?.text).toContain("minimalist logo"); // snippet source
  });
});
