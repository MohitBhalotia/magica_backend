import { describe, expect, it } from "vitest";

import { excerpt } from "@/modules/chats/chat.mapper";

describe("excerpt", () => {
  it("returns short text whole", () => {
    expect(excerpt("Make a logo for my bakery", "logo")).toBe("Make a logo for my bakery");
  });

  it("centres long text on the first case-insensitive match with ellipses", () => {
    const text = `${"a".repeat(100)} The LOGO sits here ${"b".repeat(100)}`;
    const out = excerpt(text, "logo");
    expect(out).toContain("LOGO");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(60 * 2 + "logo".length + 2);
  });

  it("falls back to the start of the text when there's no match", () => {
    expect(excerpt("x".repeat(300), "logo")).toBe("x".repeat(120));
  });
});
