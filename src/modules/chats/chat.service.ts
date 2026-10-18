import { MAX_TITLE_LENGTH } from "@mohitbhalotia/magica-contracts";

import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { chatRepository } from "@/modules/chats/chat.repository";
import { userService } from "@/modules/users/user.service";

const MESSAGES_PER_PAGE = 50;
const notFound = () => new AppError("NOT_FOUND", "Chat not found.");

async function owned(chatId: string, userId: string) {
  const chat = await chatRepository.findOwned(chatId, userId);
  // Missing and not-yours look the same: never reveal that someone else's chat exists.
  if (!chat) throw notFound();
  return chat;
}

const truncateTitle = (text: string) =>
  text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : text;

export const chatService = {
  list: (userId: string, limit: number, cursor?: string) =>
    chatRepository.list(userId, limit, cursor),

  async get(chatId: string, userId: string, cursor?: string) {
    const chat = await owned(chatId, userId);
    return { chat, messages: await chatRepository.messages(chat.id, MESSAGES_PER_PAGE, cursor) };
  },

  async create(userId: string, clientMessageId: string, text: string) {
    const { chat, message } = await db.$transaction(async (tx) => {
      await userService.ensure(userId, tx);
      const data = { id: clientMessageId, userId, title: truncateTitle(text), text };
      return chatRepository.createWithMessage(data, tx);
    });
    // Only on a client-id collision with another user's chat; same 404 as any foreign chat.
    if (chat.userId !== userId) throw notFound();
    return { chatId: chat.id, userMessageId: message.id };
  },

  async update(chatId: string, userId: string, patch: { title?: string; isPinned?: boolean }) {
    const chat = await owned(chatId, userId);
    return chatRepository.update(chat.id, { ...patch, updatedAt: chat.updatedAt });
  },

  async remove(chatId: string, userId: string) {
    await chatRepository.softDelete((await owned(chatId, userId)).id);
  },

  async duplicate(chatId: string, userId: string) {
    const chat = await owned(chatId, userId);
    const title = truncateTitle(`${chat.title} (copy)`);
    return db.$transaction((tx) => chatRepository.duplicate({ ...chat, title }, tx));
  },

  search: (userId: string, q: string, limit: number, cursor?: string) =>
    chatRepository.search(userId, q, limit, cursor),
};
