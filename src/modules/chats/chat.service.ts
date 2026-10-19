import { MAX_TITLE_LENGTH } from "@mohitbhalotia/magica-contracts";

import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { chatRepository } from "@/modules/chats/chat.repository";
import { runService } from "@/modules/runs/run.service";
import { runTask } from "@/modules/runs/run.task";
import { userService } from "@/modules/users/user.service";

type Ctx = { traceId: string; logger: Logger };

const MESSAGES_PER_PAGE = 50;
/** Auto-titles from the first prompt stay short; renames may use the full MAX_TITLE_LENGTH. */
export const PROMPT_TITLE_LENGTH = 50;
const notFound = () => new AppError("NOT_FOUND", "Chat not found.");

async function owned(chatId: string, userId: string) {
  const chat = await chatRepository.findOwned(chatId, userId);
  // Missing and not-yours look the same: never reveal that someone else's chat exists.
  if (!chat) throw notFound();
  return chat;
}

export const truncateTitle = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

export const chatService = {
  list: (userId: string, limit: number, cursor?: string) =>
    chatRepository.list(userId, limit, cursor),

  async get(chatId: string, userId: string, cursor?: string) {
    const chat = await owned(chatId, userId);
    const [messages, activeRun] = await Promise.all([
      chatRepository.messages(chat.id, MESSAGES_PER_PAGE, cursor),
      runService.activeHandle(chat.id),
    ]);
    return { chat, messages, activeRun };
  },

  async assets(chatId: string, userId: string, limit: number, cursor?: string) {
    const chat = await owned(chatId, userId);
    return chatRepository.assets(chat.id, limit, cursor);
  },

  /** First message: chat + user message + the run that answers it, in one transaction. */
  async create(userId: string, clientMessageId: string, text: string, ctx: Ctx) {
    const run = await db.$transaction(async (tx) => {
      await userService.ensure(userId, tx);
      const title = truncateTitle(text, PROMPT_TITLE_LENGTH);
      const { chat, message } = await chatRepository.createWithMessage(
        { id: clientMessageId, userId, title, text },
        tx,
      );
      // Only on a client-id collision with another user's chat; same 404 as any foreign chat.
      if (chat.userId !== userId) throw notFound();
      return runService.open(
        { chatId: chat.id, userId, userMessageId: message.id, traceId: ctx.traceId },
        tx,
      );
    });
    // The AI title runs alongside the reply; if it can't start, the prompt title stays.
    const [sent] = await Promise.all([
      runService.respond(run, ctx),
      runTask.title(run.chatId).catch((err: unknown) => {
        ctx.logger.warn(
          { err, chatId: run.chatId },
          "chat-title trigger failed; prompt title stays",
        );
      }),
    ]);
    return sent;
  },

  /** Follow-up message in an existing chat; RUN_ACTIVE while a reply is still in progress. */
  async send(chatId: string, userId: string, clientMessageId: string, text: string, ctx: Ctx) {
    const chat = await owned(chatId, userId);
    const run = await runService.withRunLock(chat.id, () =>
      db.$transaction(async (tx) => {
        const message = await chatRepository.upsertUserMessage(
          { chatId: chat.id, userId, clientMessageId, text },
          tx,
        );
        await chatRepository.touch(chat.id, tx);
        return runService.open(
          { chatId: chat.id, userId, userMessageId: message.id, traceId: ctx.traceId },
          tx,
        );
      }),
    );
    return runService.respond(run, ctx);
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
    // Same suffix as the reference ("Greeting - Copy", observed 2026-10-18).
    const title = truncateTitle(`${chat.title} - Copy`, MAX_TITLE_LENGTH);
    return db.$transaction((tx) => chatRepository.duplicate({ ...chat, title }, tx));
  },

  search: (userId: string, q: string, limit: number, cursor?: string) =>
    chatRepository.search(userId, q, limit, cursor),
};
