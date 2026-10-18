import { db as prisma, type DbClient } from "@/lib/db";

export const userRepository = {
  /** Creates the row on first use; email is filled by the Clerk webhook (M4). */
  ensure: (id: string, db: DbClient = prisma) =>
    db.user.upsert({ where: { id }, create: { id, email: "" }, update: {} }),
};
