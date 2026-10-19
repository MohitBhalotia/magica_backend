import { describe, expect, it } from "vitest";

import {
  ChatDetailSchema,
  MAX_MESSAGE_LENGTH,
  MAX_TITLE_LENGTH,
  SearchQuerySchema,
  SendMessageRequestSchema,
  SendResponseSchema,
  UpdateChatRequestSchema,
} from "../chat.ts";

const at = "2026-10-18T00:00:00Z";
const summary = {
  id: "c1",
  title: "New chat",
  titleSource: "placeholder",
  isPinned: false,
  createdAt: at,
  updatedAt: at,
};
const id = "0b9d1b6e-3c8e-4c2a-9f3b-0c6c3d1d2a11";

describe("SendMessageRequestSchema", () => {
  it("trims text and accepts a uuid clientMessageId", () => {
    expect(SendMessageRequestSchema.parse({ clientMessageId: id, text: "  hi  " }).text).toBe("hi");
  });

  it("rejects blank or oversized text and a non-uuid id", () => {
    const long = "a".repeat(MAX_MESSAGE_LENGTH + 1);
    expect(SendMessageRequestSchema.safeParse({ clientMessageId: id, text: " " }).success).toBe(
      false,
    );
    expect(SendMessageRequestSchema.safeParse({ clientMessageId: id, text: long }).success).toBe(
      false,
    );
    expect(SendMessageRequestSchema.safeParse({ clientMessageId: "x", text: "hi" }).success).toBe(
      false,
    );
  });
});

describe("SendResponseSchema", () => {
  it("carries the run handle; the trigger id and token are null until dispatched", () => {
    const run = { runId: "r1", status: "queued", triggerRunId: null, publicAccessToken: null };
    const sent = { chatId: "c1", userMessageId: "m1", assistantMessageId: "m2", run };
    expect(SendResponseSchema.parse(sent).run.status).toBe("queued");
  });
});

describe("UpdateChatRequestSchema", () => {
  it("accepts a rename or a pin", () => {
    expect(UpdateChatRequestSchema.parse({ title: " Logo " })).toEqual({ title: "Logo" });
    expect(UpdateChatRequestSchema.parse({ isPinned: true })).toEqual({ isPinned: true });
  });

  it("rejects an empty patch, a blank title and titles over the limit", () => {
    const long = "a".repeat(MAX_TITLE_LENGTH + 1);
    expect(UpdateChatRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateChatRequestSchema.safeParse({ title: " " }).success).toBe(false);
    expect(UpdateChatRequestSchema.safeParse({ title: long }).success).toBe(false);
  });
});

describe("SearchQuerySchema", () => {
  it("requires a non-blank query and keeps the page defaults", () => {
    expect(SearchQuerySchema.parse({ q: " logo " })).toEqual({ q: "logo", limit: 20 });
    expect(SearchQuerySchema.safeParse({ q: " " }).success).toBe(false);
  });
});

describe("ChatDetailSchema", () => {
  const message = (role: string) => ({
    id: "m1",
    role,
    status: "success",
    text: "hi",
    contentBlocks: [{ type: "text", text: "hi" }],
    metadata: null,
    errorCode: null,
    errorMessage: null,
    createdAt: at,
    completedAt: at,
    runId: null,
  });
  const page = (role: string) => ({
    ...summary,
    messages: { items: [message(role)], nextCursor: null },
    activeRun: null,
  });

  it("parses a chat with a page of messages and no active run", () => {
    const chat = ChatDetailSchema.parse(page("user"));
    expect(chat.messages.items).toHaveLength(1);
    expect(chat.activeRun).toBeNull();
  });

  it("rejects unknown roles", () => {
    expect(ChatDetailSchema.safeParse(page("bot")).success).toBe(false);
  });
});
