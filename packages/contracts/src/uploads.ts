import { z } from "zod";

import { pageSchema } from "./pagination.ts";

/** Upload limits (PRD §5.10): Transloadit Community allows 0.5 GB a file and 5 GB a month. */
export const MAX_ATTACHMENTS = 10;
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
export const MONTHLY_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

// Mirror the Prisma enums; a backend type check fails CI on any drift (DEC-048).
export const AttachmentKindSchema = z.enum(["image", "video", "audio"]);
export const AttachmentStatusSchema = z.enum(["uploading", "ready", "failed"]);

/** An uploaded file. `url` is a short-lived signed link, present once the file is ready. */
export const AttachmentSchema = z.object({
  id: z.string(),
  clientFileId: z.string(),
  name: z.string(),
  kind: AttachmentKindSchema,
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: AttachmentStatusSchema,
  url: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationMs: z.number().nullable(),
  /** A user-safe reason when the upload failed. */
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/** `POST /uploads`: one file the browser is about to upload. */
export const CreateUploadRequestSchema = z.object({
  /** Uppy's id for the file; sending it again returns the same upload. */
  clientFileId: z.string().min(1).max(200),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.int().positive().max(MAX_UPLOAD_BYTES),
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

/** The upload row plus the signed Transloadit options Uppy uploads with (one job per file). */
export const CreateUploadResponseSchema = z.object({
  attachment: AttachmentSchema,
  assemblyOptions: z.object({ params: z.string(), signature: z.string() }),
});
export type CreateUploadResponse = z.infer<typeof CreateUploadResponseSchema>;

/** `POST /uploads/:id/complete`: the job Uppy created, checked with Transloadit by the server. */
export const CompleteUploadRequestSchema = z.object({ assemblyId: z.string().min(1).max(100) });

/** `GET /uploads`: the user's uploads, newest first (the "Select Asset" library). */
export const AttachmentListSchema = pageSchema(AttachmentSchema);
export type AttachmentList = z.infer<typeof AttachmentListSchema>;
