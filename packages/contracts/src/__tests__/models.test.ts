import { describe, expect, it } from "vitest";

import { ModelIdSchema } from "../models.js";

describe("ModelIdSchema", () => {
  it("accepts openrouter/free", () => {
    expect(ModelIdSchema.safeParse("openrouter/free").success).toBe(true);
  });

  it("rejects any other model", () => {
    expect(ModelIdSchema.safeParse("openai/gpt-4o").success).toBe(false);
  });
});
