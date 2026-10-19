import {
  MONTHLY_UPLOAD_BYTES,
  type Attachment,
  type CreateUploadRequest,
} from "@mohitbhalotia/magica-contracts";

import type { DbClient } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { uploadRepository } from "@/modules/uploads/upload.repository";
import { userService } from "@/modules/users/user.service";
import { attachmentKey, signedUrl } from "@/providers/r2";
import { getAssembly, uploadOptions, type Assembly } from "@/providers/transloadit";

import type { Attachment as AttachmentRow, AttachmentKind } from "../../../prisma/generated/client";

// DEC-048: the contract enums mirror the Prisma enums. Any drift fails `pnpm typecheck`.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const uploadEnumParity: [
  Same<AttachmentKind, Attachment["kind"]>,
  Same<AttachmentRow["status"], Attachment["status"]>,
] = [true, true];

const KINDS: Record<string, AttachmentKind> = { image: "image", video: "video", audio: "audio" };
const notFound = () => new AppError("NOT_FOUND", "Upload not found.");

/** The browser sees a short-lived link once the file is in R2 (the bucket is private). */
export async function toAttachment(row: AttachmentRow): Promise<Attachment> {
  return {
    id: row.id,
    clientFileId: row.clientFileId,
    name: row.name,
    kind: row.kind,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    status: row.status,
    url: row.r2Key ? await signedUrl(row.r2Key, row.name) : null,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

const startOfMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

/**
 * Records what a finished upload job did (from the webhook or a confirm call), once:
 * - stored in R2 → ready, with its size details;
 * - finished but nothing stored (the filter rejected the file) or failed → failed, with a reason;
 * - still running → nothing yet.
 */
async function settle(assembly: Assembly) {
  const attachmentId = assembly.fields.attachment_id;
  const row = typeof attachmentId === "string" ? await uploadRepository.get(attachmentId) : null;
  if (!row) return;

  const stored = assembly.results.stored?.[0];
  if (assembly.ok === "ASSEMBLY_COMPLETED" && stored) {
    const { width, height, duration } = stored.meta;
    await uploadRepository.markReady(row.id, {
      assemblyId: assembly.assembly_id,
      r2Key: attachmentKey(row.userId, row.id),
      width: width ?? undefined,
      height: height ?? undefined,
      durationMs: duration ? Math.round(duration * 1000) : undefined,
    });
  } else if (assembly.ok === "ASSEMBLY_COMPLETED") {
    await uploadRepository.markFailed(
      row.id,
      assembly.assembly_id,
      "Only images, videos and audio can be uploaded.",
    );
  } else if (assembly.error || assembly.ok === "ASSEMBLY_CANCELED") {
    await uploadRepository.markFailed(
      row.id,
      assembly.assembly_id,
      "The upload failed. Try again.",
    );
  }
}

export const uploadService = {
  /**
   * Starts one file's upload (PRD §5.10): checks its type and the monthly allowance, records it,
   * and returns the signed Transloadit options Uppy uploads with.
   */
  async create(userId: string, file: CreateUploadRequest, notifyUrl: string) {
    const kind = KINDS[file.mimeType.split("/")[0] ?? ""];
    if (!kind)
      throw new AppError("VALIDATION_FAILED", "Only images, videos and audio can be uploaded.");

    const used = await uploadRepository.bytesSince(userId, startOfMonth());
    if (used + file.sizeBytes > MONTHLY_UPLOAD_BYTES)
      throw new AppError("UPLOAD_QUOTA_EXCEEDED", "You've reached this month's 5 GB upload limit.");

    await userService.ensure(userId);
    const row = await uploadRepository.create({ userId, kind, ...file });
    return {
      attachment: await toAttachment(row),
      assemblyOptions: uploadOptions({
        attachmentId: row.id,
        key: attachmentKey(userId, row.id),
        notifyUrl,
      }),
    };
  },

  /**
   * The browser says its upload job finished; the job's status is read from Transloadit itself, so
   * a missed or late webhook doesn't leave the file stuck. Safe to repeat.
   */
  async complete(userId: string, attachmentId: string, assemblyId: string) {
    const row = await uploadRepository.findOwned(attachmentId, userId);
    if (!row) throw notFound();
    if (row.status === "uploading") {
      const assembly = await getAssembly(assemblyId);
      // The job must be this file's (its id travels in the job's fields).
      if (assembly.fields.attachment_id !== row.id) throw notFound();
      await settle(assembly);
    }
    const now = await uploadRepository.findOwned(attachmentId, userId);
    if (!now) throw notFound();
    return toAttachment(now);
  },

  /** Inside the send transaction: the message's files, in the user's order (or a 400). */
  async attach(userId: string, messageId: string, attachmentIds: string[], tx: DbClient) {
    for (const [orderIndex, id] of attachmentIds.entries()) {
      const linked = await uploadRepository.attach({ id, userId, messageId, orderIndex }, tx);
      if (!linked)
        throw new AppError("VALIDATION_FAILED", "An attachment isn't ready or can't be used.");
    }
  },

  /** The Transloadit webhook (its signature was checked by the caller). */
  settle,

  async list(userId: string, limit: number, cursor?: string) {
    const page = await uploadRepository.listReady(userId, limit, cursor);
    return { ...page, items: await Promise.all(page.items.map(toAttachment)) };
  },
};
