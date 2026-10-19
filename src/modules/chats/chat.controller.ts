import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  PageQuerySchema,
  SendMessageRequestSchema,
  SearchQuerySchema,
  UpdateChatRequestSchema,
  type ChatAssetList,
  type ChatDetail,
  type ChatList,
  type ChatSummary,
  type SearchResultList,
  type SendResponse,
} from "@mohitbhalotia/magica-contracts";

import { enforceRateLimit } from "@/lib/rateLimiter";
import { withHandler } from "@/lib/withHandler";
import { toChatAsset, toChatSummary, toMessage, toSearchResult } from "@/modules/chats/chat.mapper";
import { chatService } from "@/modules/chats/chat.service";
import { toAttachment } from "@/modules/uploads/upload.service";

type ChatParams = { chatId: string };
const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

/**
 * A send's body. API clients may leave `clientMessageId` out and pass an `Idempotency-Key` header
 * (a UUID) instead; with neither, the send just isn't idempotent.
 */
async function sendBody(req: Request) {
  const body = (await req.json()) as Record<string, unknown> | null;
  return SendMessageRequestSchema.parse({
    ...body,
    clientMessageId: body?.clientMessageId ?? req.headers.get("idempotency-key") ?? randomUUID(),
  });
}

export const listChats = withHandler(async (req, { userId }) => {
  const { limit, cursor } = PageQuerySchema.parse(query(req));
  const page = await chatService.list(userId, limit, cursor);
  return NextResponse.json<ChatList>({ ...page, items: page.items.map(toChatSummary) });
});

/** First message: creates the chat and starts the reply. */
export const createChat = withHandler(async (req, { userId, traceId, logger }) => {
  await enforceRateLimit("send", userId);
  const { clientMessageId, text, attachmentIds } = await sendBody(req);
  const ctx = { traceId, logger };
  const sent = await chatService.create(userId, clientMessageId, text, ctx, attachmentIds);
  return NextResponse.json<SendResponse>(sent, { status: 201 });
});

/** Follow-up message: starts the next reply (409 RUN_ACTIVE while one is still running). */
export const sendMessage = withHandler<ChatParams>(
  async (req, { userId, params, traceId, logger }) => {
    await enforceRateLimit("send", userId);
    const { clientMessageId, text, attachmentIds } = await sendBody(req);
    const { chatId } = await params;
    const ctx = { traceId, logger };
    const sent = await chatService.send(chatId, userId, clientMessageId, text, ctx, attachmentIds);
    return NextResponse.json<SendResponse>(sent, { status: 201 });
  },
);

export const searchChats = withHandler(async (req, { userId }) => {
  const { q, limit, cursor } = SearchQuerySchema.parse(query(req));
  const page = await chatService.search(userId, q, limit, cursor);
  const items = page.items.map((c) => toSearchResult(c, q));
  return NextResponse.json<SearchResultList>({ ...page, items });
});

export const listChatAssets = withHandler<ChatParams>(async (req, { userId, params }) => {
  const { limit, cursor } = PageQuerySchema.parse(query(req));
  const page = await chatService.assets((await params).chatId, userId, limit, cursor);
  return NextResponse.json<ChatAssetList>({ ...page, items: page.items.map(toChatAsset) });
});

export const getChat = withHandler<ChatParams>(async (req, { userId, params }) => {
  const { cursor } = PageQuerySchema.parse(query(req));
  const { chat, messages, activeRun } = await chatService.get(
    (await params).chatId,
    userId,
    cursor,
  );
  // Attachments get fresh signed links (the bucket is private).
  const items = await Promise.all(
    messages.items.map(async (m) => ({
      ...toMessage(m),
      attachments: await Promise.all(m.attachments.map(toAttachment)),
    })),
  );
  return NextResponse.json<ChatDetail>({
    ...toChatSummary(chat),
    messages: { ...messages, items },
    activeRun,
  });
});

export const updateChat = withHandler<ChatParams>(async (req, { userId, params }) => {
  const patch = UpdateChatRequestSchema.parse(await req.json());
  const chat = await chatService.update((await params).chatId, userId, patch);
  return NextResponse.json<ChatSummary>(toChatSummary(chat));
});

export const deleteChat = withHandler<ChatParams>(async (_req, { userId, params }) => {
  await chatService.remove((await params).chatId, userId);
  return new NextResponse(null, { status: 204 });
});

export const duplicateChat = withHandler<ChatParams>(async (_req, { userId, params }) => {
  const copy = await chatService.duplicate((await params).chatId, userId);
  return NextResponse.json<ChatSummary>(toChatSummary(copy), { status: 201 });
});
