import type { Waitpoint } from "@mohitbhalotia/magica-contracts";

import { db as prisma, type DbClient } from "@/lib/db";

import {
  WaitpointStatus,
  type Prisma,
  type Waitpoint as WaitpointRow,
  type WaitpointType,
} from "../../../prisma/generated/client";

type NewWaitpoint = {
  userId: string;
  chatId: string;
  runId: string;
  toolCallId: string;
  type: WaitpointType;
  request: Prisma.InputJsonValue;
  tokenId: string;
  idempotencyKey: string;
  expiresAt: Date;
};

/** The waitpoint as the browser sees it (its request was checked against the type when made). */
export const toWaitpoint = (row: WaitpointRow) =>
  ({
    id: row.id,
    type: row.type,
    request: row.request,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
  }) as Waitpoint;

export const waitpointRepository = {
  /** The waitpoint for one question; a retried tool call gets the existing row back. */
  open: (data: NewWaitpoint, db: DbClient = prisma) =>
    db.waitpoint.upsert({
      where: { idempotencyKey: data.idempotencyKey },
      create: data,
      update: {},
    }),

  get: (id: string, db: DbClient = prisma) => db.waitpoint.findUniqueOrThrow({ where: { id } }),

  findOwned: (id: string, userId: string, db: DbClient = prisma) =>
    db.waitpoint.findFirst({ where: { id, userId } }),

  findPending: (runId: string, db: DbClient = prisma) =>
    db.waitpoint.findFirst({ where: { runId, status: WaitpointStatus.pending } }),

  /** Whether the user already declined a credit approval in this run. */
  hasDeclined: async (runId: string, db: DbClient = prisma) =>
    (await db.waitpoint.count({
      where: {
        runId,
        status: WaitpointStatus.answered,
        type: "credit_approval",
        response: { path: ["approved"], equals: false },
      },
    })) > 0,

  /** pending → answered, exactly once: true only for the answer that won. */
  async answer(id: string, response: Prisma.InputJsonValue, db: DbClient = prisma) {
    const { count } = await db.waitpoint.updateMany({
      where: { id, status: WaitpointStatus.pending },
      data: { status: WaitpointStatus.answered, response, answeredAt: new Date() },
    });
    return count === 1;
  },

  /** pending → expired or cancelled; an answered waitpoint stays answered. */
  close: (
    id: string,
    status: typeof WaitpointStatus.expired | typeof WaitpointStatus.cancelled,
    db: DbClient = prisma,
  ) =>
    db.waitpoint.updateMany({ where: { id, status: WaitpointStatus.pending }, data: { status } }),
};
