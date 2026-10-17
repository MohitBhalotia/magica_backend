import { describe, expect, it } from "vitest";

import { EnvSchema } from "@/lib/env";

describe("EnvSchema", () => {
  it("defaults the LLM model to openrouter/free", () => {
    expect(EnvSchema.parse({}).OPENROUTER_MODEL).toBe("openrouter/free");
  });

  it("rejects any paid or non-free model", () => {
    expect(EnvSchema.safeParse({ OPENROUTER_MODEL: "openai/gpt-4o" }).success).toBe(false);
  });
});
