import { NextResponse } from "next/server";

import {
  CreateChatRequestSchema,
  PageQuerySchema,
  SearchQuerySchema,
  UpdateChatRequestSchema,
  type ChatDetail,
  type ChatList,
  type ChatSummary,
  type CreateChatResponse,
  type SearchResultList,
} from "@mohitbhalotia/magica-contracts";

import { enforceRateLimit } from "@/lib/rateLimiter";
import { withHandler } from "@/lib/withHandler";
import { toChatSummary, toMessage, toSearchResult } from "@/modules/chats/chat.mapper";
import { chatService } from "@/modules/chats/chat.service";

type ChatParams = { chatId: string };
const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

export const listChats = withHandler(async (req, { userId }) => {
  const { limit, cursor } = PageQuerySchema.parse(query(req));
  const page = await chatService.list(userId, limit, cursor);
  return NextResponse.json<ChatList>({ ...page, items: page.items.map(toChatSummary) });
});

export const createChat = withHandler(async (req, { userId }) => {
  await enforceRateLimit("send", userId);
  const { clientMessageId, text } = CreateChatRequestSchema.parse(await req.json());
  const created = await chatService.create(userId, clientMessageId, text);
  return NextResponse.json<CreateChatResponse>(created, { status: 201 });
});

export const searchChats = withHandler(async (req, { userId }) => {
  const { q, limit, cursor } = SearchQuerySchema.parse(query(req));
  const page = await chatService.search(userId, q, limit, cursor);
  const items = page.items.map((c) => toSearchResult(c, q));
  return NextResponse.json<SearchResultList>({ ...page, items });
});

export const getChat = withHandler<ChatParams>(async (req, { userId, params }) => {
  const { cursor } = PageQuerySchema.parse(query(req));
  const { chat, messages } = await chatService.get((await params).chatId, userId, cursor);
  return NextResponse.json<ChatDetail>({
    ...toChatSummary(chat),
    messages: { ...messages, items: messages.items.map(toMessage) },
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
