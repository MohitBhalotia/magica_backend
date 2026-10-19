import { db as prisma, type DbClient } from "@/lib/db";

/** How often `lastUsedAt` is written: once a minute at most, not on every request. */
const LAST_USED_EVERY_MS = 60_000;

export const apiKeyRepository = {
  create: (
    data: { userId: string; name: string; prefix: string; hash: string },
    db: DbClient = prisma,
  ) => db.apiKey.create({ data }),

  /** The live key with this hash, if any (a revoked key is the same as no key). */
  findActive: (hash: string, db: DbClient = prisma) =>
    db.apiKey.findFirst({ where: { hash, revokedAt: null } }),

  touch: (id: string, now = new Date(), db: DbClient = prisma) =>
    db.apiKey.updateMany({
      where: {
        id,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_EVERY_MS) } },
        ],
      },
      data: { lastUsedAt: now },
    }),

  /** The user's live keys, newest first. */
  async list(userId: string, limit: number, cursor?: string, db: DbClient = prisma) {
    const rows = await db.apiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  },

  /** Revokes the user's key; the count is 0 when it isn't theirs (or is already revoked). */
  revoke: (id: string, userId: string, db: DbClient = prisma) =>
    db.apiKey.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
};
