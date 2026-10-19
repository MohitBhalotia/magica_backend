import { db as prisma, type DbClient } from "@/lib/db";

import { MessageRole, MessageStatus, TitleSource } from "../../../prisma/generated/client";

const recentFirst = [{ isPinned: "desc" }, { updatedAt: "desc" }, { id: "desc" }] as const;
const notDeleted = (userId: string) => ({ userId, deletedAt: null });

/** Keyset page: fetch one extra row to know whether another page exists; the cursor is the last id. */
function page<T extends { id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}
/** Start after the client's last-seen row (Prisma cursor + skip the cursor row itself). */
const after = (cursor?: string) => ({
  cursor: cursor ? { id: cursor } : undefined,
  skip: cursor ? 1 : 0,
});

export const chatRepository = {
  async list(userId: string, limit: number, cursor?: string, db: DbClient = prisma) {
    const rows = await db.chat.findMany({
      where: notDeleted(userId),
      orderBy: [...recentFirst],
      take: limit + 1,
      ...after(cursor),
    });
    return page(rows, limit);
  },

  findOwned: (id: string, userId: string, db: DbClient = prisma) =>
    db.chat.findFirst({ where: { id, ...notDeleted(userId) } }),

  /** The files modal: the chat's generated files, newest first (index chatId, createdAt, id). */
  async assets(chatId: string, limit: number, cursor?: string, db: DbClient = prisma) {
    const rows = await db.asset.findMany({
      where: { chatId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...after(cursor),
    });
    return page(rows, limit);
  },

  async messages(chatId: string, limit: number, cursor?: string, db: DbClient = prisma) {
    const rows = await db.message.findMany({
      where: { chatId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...after(cursor),
    });
    return page(rows, limit);
  },

  /**
   * Chat + first user message, idempotent: the chat id is the client's message id, and both
   * writes are upserts (native INSERT … ON CONFLICT), so a retried send returns the same rows.
   */
  async createWithMessage(
    data: { id: string; userId: string; title: string; text: string },
    db: DbClient = prisma,
  ) {
    const chat = await db.chat.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        userId: data.userId,
        title: data.title,
        titleSource: TitleSource.prompt,
      },
      update: {},
    });
    const message = await chatRepository.upsertUserMessage(
      { chatId: chat.id, userId: chat.userId, clientMessageId: data.id, text: data.text },
      db,
    );
    return { chat, message };
  },

  /** A user message, idempotent per `(chatId, clientMessageId)`: a retried send returns the same row. */
  upsertUserMessage: (
    data: { chatId: string; userId: string; clientMessageId: string; text: string },
    db: DbClient = prisma,
  ) =>
    db.message.upsert({
      where: {
        chatId_clientMessageId: { chatId: data.chatId, clientMessageId: data.clientMessageId },
      },
      create: { ...data, role: MessageRole.user, status: MessageStatus.success },
      update: {},
    }),

  /** The model's context: the last `limit` settled user/assistant messages, oldest first. */
  async history(chatId: string, limit: number, db: DbClient = prisma) {
    const rows = await db.message.findMany({
      where: {
        chatId,
        role: { in: [MessageRole.user, MessageRole.assistant] },
        status: MessageStatus.success,
        text: { not: "" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: { role: true, text: true },
    });
    return rows.reverse();
  },

  /** AI title, only while the chat still has its prompt title: a user rename always wins. */
  setGeneratedTitle: (id: string, title: string, db: DbClient = prisma) =>
    db.chat.updateMany({
      where: { id, titleSource: TitleSource.prompt },
      data: { title, titleSource: TitleSource.generated },
    }),

  /** New activity moves the chat to the top of the sidebar. */
  touch: (id: string, db: DbClient = prisma) =>
    db.chat.update({ where: { id }, data: { updatedAt: new Date() } }),

  /** `updatedAt` is passed through so renaming or pinning doesn't reorder the sidebar. */
  update: (
    id: string,
    data: { title?: string; isPinned?: boolean; updatedAt: Date },
    db: DbClient = prisma,
  ) =>
    db.chat.update({
      where: { id },
      data: {
        ...data,
        ...(data.title !== undefined && { titleSource: TitleSource.user }),
        ...(data.isPinned !== undefined && { pinnedAt: data.isPinned ? new Date() : null }),
      },
    }),

  softDelete: (id: string, db: DbClient = prisma) =>
    db.chat.update({ where: { id }, data: { deletedAt: new Date() } }),

  /**
   * Copies the chat and its settled messages (not runs, not a reply still being written); messages
   * keep their timestamps and order.
   */
  async duplicate(source: { id: string; userId: string; title: string }, db: DbClient = prisma) {
    const copy = await db.chat.create({
      data: { userId: source.userId, title: source.title, titleSource: TitleSource.user },
    });
    const messages = await db.message.findMany({
      where: {
        chatId: source.id,
        status: { notIn: [MessageStatus.pending, MessageStatus.streaming] },
      },
    });
    await db.message.createMany({
      data: messages.map((m) => ({
        chatId: copy.id,
        userId: m.userId,
        role: m.role,
        status: m.status,
        text: m.text,
        contentBlocks: m.contentBlocks ?? [],
        metadata: m.metadata ?? undefined,
        createdAt: m.createdAt,
      })),
    });
    return copy;
  },

  /** Case-insensitive substring match on titles and message text; newest first, id cursor. */
  async search(userId: string, q: string, limit: number, cursor?: string, db: DbClient = prisma) {
    const contains = { contains: q, mode: "insensitive" } as const;
    const rows = await db.chat.findMany({
      where: {
        ...notDeleted(userId),
        OR: [{ title: contains }, { messages: { some: { text: contains } } }],
      },
      include: { messages: { where: { text: contains }, select: { text: true }, take: 1 } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...after(cursor),
    });
    return page(rows, limit);
  },
};
