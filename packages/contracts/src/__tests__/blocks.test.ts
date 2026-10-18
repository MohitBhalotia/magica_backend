import { describe, expect, it } from "vitest";

import { ContentBlocksSchema } from "../blocks.ts";

describe("ContentBlocksSchema", () => {
  it("keeps an ordered mix of reasoning, text and notices", () => {
    const blocks = [
      { type: "reasoning", text: "Plan the answer", durationMs: 1200 },
      { type: "text", text: "Hello" },
      { type: "notice", level: "warning", code: "MODEL_UNAVAILABLE", message: "Stopped early." },
    ];
    expect(ContentBlocksSchema.parse(blocks).map((b) => b.type)).toEqual([
      "reasoning",
      "text",
      "notice",
    ]);
  });

  it("rejects unknown block types, unknown error codes and negative durations", () => {
    expect(ContentBlocksSchema.safeParse([{ type: "image", url: "x" }]).success).toBe(false);
    expect(
      ContentBlocksSchema.safeParse([
        { type: "notice", level: "error", code: "NOPE", message: "x" },
      ]).success,
    ).toBe(false);
    expect(
      ContentBlocksSchema.safeParse([{ type: "reasoning", text: "x", durationMs: -1 }]).success,
    ).toBe(false);
  });
});
