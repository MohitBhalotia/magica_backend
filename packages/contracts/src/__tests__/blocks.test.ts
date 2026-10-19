import { describe, expect, it } from "vitest";

import { ContentBlocksSchema, MessageMetadataSchema } from "../blocks.ts";

describe("ContentBlocksSchema", () => {
  it("accepts AI SDK message parts and drops fields we don't store", () => {
    const parts = [
      { type: "step-start" },
      { type: "reasoning", text: "Plan the answer", state: "done", providerMetadata: { x: 1 } },
      { type: "text", text: "Hello", state: "done" },
    ];
    expect(ContentBlocksSchema.parse(parts)).toEqual([
      { type: "step-start" },
      { type: "reasoning", text: "Plan the answer", state: "done" },
      { type: "text", text: "Hello", state: "done" },
    ]);
  });

  it("rejects unknown part types and states", () => {
    expect(ContentBlocksSchema.safeParse([{ type: "image", url: "x" }]).success).toBe(false);
    expect(ContentBlocksSchema.safeParse([{ type: "text", text: "x", state: "x" }]).success).toBe(
      false,
    );
  });
});

describe("MessageMetadataSchema", () => {
  it("keeps thinking time as whole non-negative milliseconds", () => {
    expect(MessageMetadataSchema.parse({ thinkingMs: 900 })).toEqual({ thinkingMs: 900 });
    expect(MessageMetadataSchema.safeParse({ thinkingMs: -1 }).success).toBe(false);
  });
});
