import { describe, expect, it } from "vitest";

import { CreateUploadRequestSchema, MAX_UPLOAD_BYTES } from "../uploads.ts";

const file = { clientFileId: "uppy-1", name: "clip.mp4", mimeType: "video/mp4" };

describe("CreateUploadRequestSchema", () => {
  it("accepts a file up to 512 MB and rejects anything larger", () => {
    expect(MAX_UPLOAD_BYTES).toBe(512 * 1024 * 1024);
    expect(
      CreateUploadRequestSchema.safeParse({ ...file, sizeBytes: MAX_UPLOAD_BYTES }).success,
    ).toBe(true);
    expect(
      CreateUploadRequestSchema.safeParse({ ...file, sizeBytes: MAX_UPLOAD_BYTES + 1 }).success,
    ).toBe(false);
  });
});
