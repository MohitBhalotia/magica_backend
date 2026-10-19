import { randomUUID } from "node:crypto";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MONTHLY_UPLOAD_BYTES } from "@mohitbhalotia/magica-contracts";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { chatRepository } from "@/modules/chats/chat.repository";
import { chatService } from "@/modules/chats/chat.service";
import { uploadService } from "@/modules/uploads/upload.service";
import type { Assembly } from "@/providers/transloadit";

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: vi.fn((_id: string, p: { runId?: string }) => ({ id: `trig_${p.runId ?? "x"}` })),
  },
  auth: { createPublicToken: vi.fn(() => "pk_test") },
  runs: { cancel: vi.fn() },
}));

const TRANSLOADIT = "https://api2.transloadit.com";
const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const NOTIFY = "https://api.test/api/webhooks/transloadit";
let userId: string;
beforeEach(() => {
  userId = `user_test_${randomUUID()}`;
});

const photo = (patch: object = {}) => ({
  clientFileId: randomUUID(),
  name: "sky.png",
  mimeType: "image/png",
  sizeBytes: 1_153_434,
  ...patch,
});

const ctx = { traceId: "t", logger };

/** An upload of the user's that finished, ready to send. */
async function ready() {
  const { attachment } = await uploadService.create(userId, photo(), NOTIFY);
  await uploadService.settle(completed(attachment.id));
  return attachment.id;
}

/** A finished Transloadit job for `attachmentId`, as the webhook or the status API reports it. */
const completed = (attachmentId: string, stored = true): Assembly => ({
  assembly_id: `asm_${randomUUID()}`,
  ok: "ASSEMBLY_COMPLETED",
  fields: { attachment_id: attachmentId },
  results: stored
    ? { stored: [{ size: 1_153_434, mime: "image/png", meta: { width: 1024, height: 768 } }] }
    : {},
});

describe("uploads", () => {
  it("starts an upload: the row is uploading and the options are signed for Uppy", async () => {
    const { attachment, assemblyOptions } = await uploadService.create(userId, photo(), NOTIFY);

    expect(attachment).toMatchObject({ status: "uploading", kind: "image", url: null });
    expect(JSON.parse(assemblyOptions.params)).toMatchObject({
      fields: { attachment_id: attachment.id },
    });
    expect(assemblyOptions.signature).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("the same file twice is one upload", async () => {
    const file = photo();
    const first = await uploadService.create(userId, file, NOTIFY);
    const again = await uploadService.create(userId, file, NOTIFY);

    expect(again.attachment.id).toBe(first.attachment.id);
  });

  it("refuses non-media files and anything past the monthly allowance", async () => {
    await expect(
      uploadService.create(userId, photo({ mimeType: "application/pdf" }), NOTIFY),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await uploadService.create(userId, photo({ sizeBytes: MONTHLY_UPLOAD_BYTES - 10 }), NOTIFY);
    await expect(
      uploadService.create(userId, photo({ sizeBytes: 100 }), NOTIFY),
    ).rejects.toMatchObject({ code: "UPLOAD_QUOTA_EXCEEDED" });
  });

  it("the webhook makes it ready, with a signed link; a repeat changes nothing", async () => {
    const { attachment } = await uploadService.create(userId, photo(), NOTIFY);
    const job = completed(attachment.id);

    await uploadService.settle(job);
    await uploadService.settle(job);

    const [ready] = (await uploadService.list(userId, 20)).items;
    expect(ready).toMatchObject({ id: attachment.id, status: "ready", width: 1024, height: 768 });
    expect(ready?.url).toContain(`/uploads/${userId}/${attachment.id}`);
    expect(ready?.url).toContain("X-Amz-Signature=");
  });

  it("a file the filter rejected fails with a reason, and isn't in the library", async () => {
    const { attachment } = await uploadService.create(userId, photo(), NOTIFY);

    await uploadService.settle(completed(attachment.id, false));

    const row = await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(row.status).toBe("failed");
    expect(row.error).toContain("Only images");
    expect((await uploadService.list(userId, 20)).items).toHaveLength(0);
  });

  it("complete asks Transloadit when the webhook is late, and only for this file's job", async () => {
    const { attachment } = await uploadService.create(userId, photo(), NOTIFY);
    const job = completed(attachment.id);
    server.use(
      http.get(`${TRANSLOADIT}/assemblies/${job.assembly_id}`, () => HttpResponse.json(job)),
      http.get(`${TRANSLOADIT}/assemblies/someone_elses`, () =>
        HttpResponse.json(completed("att_other")),
      ),
    );

    await expect(
      uploadService.complete(userId, attachment.id, "someone_elses"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await uploadService.complete(userId, attachment.id, job.assembly_id)).toMatchObject({
      status: "ready",
    });
  });

  it("a send links ready files in the user's order; a replay links them again", async () => {
    const [a, b] = await Promise.all([ready(), ready()]);
    const clientMessageId = randomUUID();

    const sent = await chatService.create(userId, clientMessageId, "merge these", ctx, [b, a]);
    await chatService.create(userId, clientMessageId, "merge these", ctx, [b, a]);

    const linked = await db.attachment.findMany({
      where: { messageId: sent.userMessageId },
      orderBy: { orderIndex: "asc" },
    });
    expect(linked.map((row) => row.id)).toEqual([b, a]);
    const history = await chatRepository.history(sent.chatId, 20);
    expect(history[0]?.attachments.map((file) => file.r2Key)).toEqual([
      `uploads/${userId}/${b}`,
      `uploads/${userId}/${a}`,
    ]);
  });

  it("a file that isn't ready, or isn't yours, fails the send and saves nothing", async () => {
    const { attachment: pending } = await uploadService.create(userId, photo(), NOTIFY);
    const theirs = `user_test_${randomUUID()}`;
    const { attachment: other } = await uploadService.create(theirs, photo(), NOTIFY);
    await uploadService.settle(completed(other.id));

    for (const id of [pending.id, other.id]) {
      await expect(
        chatService.create(userId, randomUUID(), "edit this", ctx, [id]),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect(await db.chat.count({ where: { userId } })).toBe(0);
  });

  it("someone else's upload is NOT_FOUND", async () => {
    const { attachment } = await uploadService.create(userId, photo(), NOTIFY);

    await expect(
      uploadService.complete("user_other", attachment.id, "asm_x"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
