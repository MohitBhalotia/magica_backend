import { describe, expect, it } from "vitest";

import { REASONING_STREAM, RunMetadataSchema, TEXT_STREAM } from "../realtime.ts";

describe("realtime contract", () => {
  it("uses distinct stream ids", () => {
    expect(TEXT_STREAM).not.toBe(REASONING_STREAM);
  });

  it("run metadata stays small and typed", () => {
    expect(RunMetadataSchema.parse({ status: "working", thinkingMs: 900 })).toEqual({
      status: "working",
      thinkingMs: 900,
    });
    expect(RunMetadataSchema.safeParse({ status: "working", thinkingMs: 1.5 }).success).toBe(false);
  });
});
