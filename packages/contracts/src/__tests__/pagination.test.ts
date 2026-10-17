import { describe, expect, it } from "vitest";
import { z } from "zod";

import { PageQuerySchema, pageSchema } from "../pagination.js";

describe("PageQuerySchema", () => {
  it("defaults limit to 20", () => {
    expect(PageQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it("coerces query-string limits", () => {
    expect(PageQuerySchema.parse({ limit: "50", cursor: "c" })).toEqual({ limit: 50, cursor: "c" });
  });

  it("rejects limits outside 1..50", () => {
    expect(PageQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(PageQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});

describe("pageSchema", () => {
  it("wraps any item schema", () => {
    const page = pageSchema(z.object({ id: z.string() }));
    expect(page.parse({ items: [{ id: "a" }], nextCursor: null }).items).toHaveLength(1);
  });
});
