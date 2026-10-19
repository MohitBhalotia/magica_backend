import { NextResponse } from "next/server";

import {
  CompleteUploadRequestSchema,
  CreateUploadRequestSchema,
  PageQuerySchema,
  type Attachment,
  type AttachmentList,
  type CreateUploadResponse,
} from "@mohitbhalotia/magica-contracts";

import { AppError } from "@/lib/errors";
import { withHandler, withPublicHandler } from "@/lib/withHandler";
import { uploadService } from "@/modules/uploads/upload.service";
import { AssemblySchema, isSignedByTransloadit } from "@/providers/transloadit";

/** Start one file's upload; Transloadit calls our webhook on this same host when it's done. */
export const createUpload = withHandler(async (req, { userId }) => {
  const file = CreateUploadRequestSchema.parse(await req.json());
  const notifyUrl = new URL("/api/webhooks/transloadit", req.url).toString();
  const created = await uploadService.create(userId, file, notifyUrl);
  return NextResponse.json<CreateUploadResponse>(created, { status: 201 });
});

export const completeUpload = withHandler<{ uploadId: string }>(async (req, { userId, params }) => {
  const { assemblyId } = CompleteUploadRequestSchema.parse(await req.json());
  const attachment = await uploadService.complete(userId, (await params).uploadId, assemblyId);
  return NextResponse.json<Attachment>(attachment);
});

export const listUploads = withHandler(async (req, { userId }) => {
  const { limit, cursor } = PageQuerySchema.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  return NextResponse.json<AttachmentList>(await uploadService.list(userId, limit, cursor));
});

/**
 * Transloadit's notify_url: a multipart form with the job status (`transloadit`) and its
 * `signature`. Only a correctly signed status is believed; repeats are harmless.
 */
export const transloaditWebhook = withPublicHandler(async (req) => {
  const form = await req.formData();
  const payload = form.get("transloadit");
  const signature = form.get("signature");
  if (typeof payload !== "string" || typeof signature !== "string")
    throw new AppError("VALIDATION_FAILED", "Missing transloadit or signature.");
  if (!isSignedByTransloadit(payload, signature))
    throw new AppError("UNAUTHENTICATED", "Bad signature.");

  await uploadService.settle(AssemblySchema.parse(JSON.parse(payload)));
  return NextResponse.json({ ok: true });
});
