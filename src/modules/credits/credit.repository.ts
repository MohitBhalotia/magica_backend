import { db as prisma, type DbClient } from "@/lib/db";
import { AppError } from "@/lib/errors";

import { LedgerType } from "../../../prisma/generated/client";

export type LedgerEntry = {
  userId: string;
  type: LedgerType;
  /** Signed microcredits: positive adds to the balance, negative takes away. */
  amountMicro: bigint;
  idempotencyKey: string;
  runId?: string;
  invocationId?: string;
  note?: string;
};

export const creditRepository = {
  /**
   * Appends one ledger entry and moves the cached balance by its amount, exactly once per
   * idempotency key: a replayed key inserts nothing and changes nothing (returns false).
   * A reserve must be covered by the balance; charges are never refused (the work is done).
   * Call inside a transaction, so a refused reserve also undoes its ledger row.
   */
  async post(entry: LedgerEntry, tx: DbClient) {
    const { count } = await tx.creditLedger.createMany({ data: [entry], skipDuplicates: true });
    if (count === 0) return false;

    if (entry.type === LedgerType.reserve) {
      // Conditional update: the row lock makes concurrent reserves queue, so none overdraws.
      const { count: covered } = await tx.creditAccount.updateMany({
        where: { userId: entry.userId, balanceMicro: { gte: -entry.amountMicro } },
        data: { balanceMicro: { increment: entry.amountMicro } },
      });
      if (!covered) throw new AppError("INSUFFICIENT_CREDITS", "You're out of credits.");
    } else {
      await tx.creditAccount.upsert({
        where: { userId: entry.userId },
        create: { userId: entry.userId, balanceMicro: entry.amountMicro },
        update: { balanceMicro: { increment: entry.amountMicro } },
      });
    }
    return true;
  },

  findByKey: (idempotencyKey: string, db: DbClient = prisma) =>
    db.creditLedger.findUnique({ where: { idempotencyKey } }),

  balance: async (userId: string, db: DbClient = prisma) =>
    (await db.creditAccount.findUnique({ where: { userId } }))?.balanceMicro ?? 0n,

  /** What a run's tools were charged, for the turn footer. */
  async chargedForRun(runId: string, db: DbClient = prisma) {
    const { _sum } = await db.creditLedger.aggregate({
      where: { runId, type: LedgerType.charge },
      _sum: { amountMicro: true },
    });
    return -(_sum.amountMicro ?? 0n);
  },

  /** /usage Overview: the user's charges grouped by tool (one row per tool, so it stays small). */
  usageByTool: (userId: string, db: DbClient = prisma) =>
    db.$queryRaw<{ tool: string; debited: bigint; executions: bigint; latest: Date }[]>`
      SELECT ti.tool_name AS tool, -SUM(cl.amount_micro) AS debited,
             COUNT(*) AS executions, MAX(cl.created_at) AS latest
      FROM credit_ledger cl
      JOIN tool_invocations ti ON ti.id = cl.invocation_id
      WHERE cl.user_id = ${userId} AND cl.type = 'charge'
      GROUP BY ti.tool_name
      ORDER BY latest DESC`,

  /** When the user's credits started: the start of their usage period. */
  async firstEntryAt(userId: string, db: DbClient = prisma) {
    const first = await db.creditLedger.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    return first?.createdAt;
  },

  /** /usage Detailed View: one tool's charges, newest first. */
  async toolCharges(
    userId: string,
    tool: string,
    limit: number,
    cursor?: string,
    db: DbClient = prisma,
  ) {
    const rows = await db.creditLedger.findMany({
      where: { userId, type: LedgerType.charge, invocation: { toolName: tool } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  },
};
