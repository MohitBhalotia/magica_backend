import { describe, expect, it } from "vitest";

import { EnvSchema } from "@/lib/env";

const base = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
  CLERK_SECRET_KEY: "sk_test_x",
  FRONTEND_ORIGINS: "http://localhost:3000",
  UPSTASH_REDIS_URL: "https://x.upstash.io",
  UPSTASH_REDIS_TOKEN: "t",
};

describe("EnvSchema", () => {
  it("defaults the LLM model to openrouter/free", () => {
    expect(EnvSchema.parse(base).OPENROUTER_MODEL).toBe("openrouter/free");
  });

  it("rejects any paid or non-free model", () => {
    expect(EnvSchema.safeParse({ ...base, OPENROUTER_MODEL: "openai/gpt-4o" }).success).toBe(false);
  });

  it("requires Clerk keys", () => {
    expect(EnvSchema.safeParse({ ...base, CLERK_SECRET_KEY: undefined }).success).toBe(false);
  });

  it("splits frontend origins and rejects non-URLs", () => {
    const origins = "http://localhost:3000, https://app.example.com";
    expect(EnvSchema.parse({ ...base, FRONTEND_ORIGINS: origins }).FRONTEND_ORIGINS).toEqual([
      "http://localhost:3000",
      "https://app.example.com",
    ]);
    expect(EnvSchema.safeParse({ ...base, FRONTEND_ORIGINS: "nope" }).success).toBe(false);
  });
});
