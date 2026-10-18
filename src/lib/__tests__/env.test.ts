import { describe, expect, it } from "vitest";

import { EnvSchema } from "@/lib/env";
import { WorkerEnvSchema } from "@/lib/workerEnv";

const db = { DATABASE_URL: "postgresql://u:p@localhost:5432/db" };
const api = {
  ...db,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
  CLERK_SECRET_KEY: "sk_test_x",
  FRONTEND_ORIGINS: "http://localhost:3000",
  UPSTASH_REDIS_URL: "https://x.upstash.io",
  UPSTASH_REDIS_TOKEN: "t",
};
const worker = { ...db, OPENROUTER_API_KEY: "sk-or-x" };

describe("EnvSchema (API)", () => {
  it("requires Clerk keys", () => {
    expect(EnvSchema.safeParse({ ...api, CLERK_SECRET_KEY: undefined }).success).toBe(false);
  });

  it("splits frontend origins and rejects non-URLs", () => {
    const origins = "http://localhost:3000, https://app.example.com";
    expect(EnvSchema.parse({ ...api, FRONTEND_ORIGINS: origins }).FRONTEND_ORIGINS).toEqual([
      "http://localhost:3000",
      "https://app.example.com",
    ]);
    expect(EnvSchema.safeParse({ ...api, FRONTEND_ORIGINS: "nope" }).success).toBe(false);
  });
});

describe("WorkerEnvSchema", () => {
  it("needs only the database and OpenRouter, never the API's Clerk or Upstash vars", () => {
    expect(WorkerEnvSchema.safeParse(worker).success).toBe(true);
  });

  it("defaults the LLM model to openrouter/free and rejects any paid model", () => {
    expect(WorkerEnvSchema.parse(worker).OPENROUTER_MODEL).toBe("openrouter/free");
    expect(
      WorkerEnvSchema.safeParse({ ...worker, OPENROUTER_MODEL: "openai/gpt-4o" }).success,
    ).toBe(false);
  });

  it("requires the OpenRouter key", () => {
    expect(WorkerEnvSchema.safeParse(db).success).toBe(false);
  });
});
