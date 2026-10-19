import { db as prisma, type DbClient } from "@/lib/db";

import { AttachmentStatus, type AttachmentKind } from "../../../prisma/generated/client";

type NewUpload = {
  userId: string;
  clientFileId: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  sizeBytes: number;
};

export type UploadMeta = { width?: number; height?: number; durationMs?: number };

export const uploadRepository = {
  /** One row per file; a retried request with the same clientFileId gets the existing row. */
  create: (data: NewUpload, db: DbClient = prisma) =>
    db.attachment.upsert({
      where: { userId_clientFileId: { userId: data.userId, clientFileId: data.clientFileId } },
      create: data,
      update: {},
    }),

  /** A failed upload being retried: back to uploading, under a new job. */
  restart: (id: string, db: DbClient = prisma) =>
    db.attachment.update({
      where: { id },
      data: { status: AttachmentStatus.uploading, error: null, assemblyId: null },
    }),

  findOwned: (id: string, userId: string, db: DbClient = prisma) =>
    db.attachment.findFirst({ where: { id, userId } }),

  get: (id: string, db: DbClient = prisma) => db.attachment.findUnique({ where: { id } }),

  /** uploading → ready, once: a repeated webhook or confirm changes nothing. */
  markReady: (
    id: string,
    data: { assemblyId: string; r2Key: string } & UploadMeta,
    db: DbClient = prisma,
  ) =>
    db.attachment.updateMany({
      where: { id, status: AttachmentStatus.uploading },
      data: { ...data, status: AttachmentStatus.ready },
    }),

  /** uploading → failed, once, with a user-safe reason. */
  markFailed: (id: string, assemblyId: string, error: string, db: DbClient = prisma) =>
    db.attachment.updateMany({
      where: { id, status: AttachmentStatus.uploading },
      data: { assemblyId, error, status: AttachmentStatus.failed },
    }),

  /**
   * Links a ready upload of the user's to a message at `orderIndex`. A replayed send (same message)
   * may link it again; false if it isn't theirs, isn't ready, or went with another message.
   */
  async attach(
    data: { id: string; userId: string; messageId: string; orderIndex: number },
    db: DbClient = prisma,
  ) {
    const { count } = await db.attachment.updateMany({
      where: {
        id: data.id,
        userId: data.userId,
        status: AttachmentStatus.ready,
        OR: [{ messageId: null }, { messageId: data.messageId }],
      },
      data: { messageId: data.messageId, orderIndex: data.orderIndex },
    });
    return count === 1;
  },

  /** Bytes the user has uploaded (or is uploading) since `since`, for the monthly allowance. */
  async bytesSince(userId: string, since: Date, db: DbClient = prisma) {
    const { _sum } = await db.attachment.aggregate({
      where: {
        userId,
        createdAt: { gte: since },
        status: { in: [AttachmentStatus.uploading, AttachmentStatus.ready] },
      },
      _sum: { sizeBytes: true },
    });
    return Number(_sum.sizeBytes ?? 0n);
  },

  /** The "Select Asset" library: the user's ready uploads, newest first. */
  async listReady(userId: string, limit: number, cursor?: string, db: DbClient = prisma) {
    const rows = await db.attachment.findMany({
      where: { userId, status: AttachmentStatus.ready },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  },
};
