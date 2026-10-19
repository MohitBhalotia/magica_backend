import { afterEach, expect, it, vi } from "vitest";

// The worker has only its own env (workerEnv): no Clerk, Upstash or Transloadit keys. Trigger.dev
// imports every task file when it deploys, so nothing they import may read the API's env at import.
const API_ONLY = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "FRONTEND_ORIGINS",
  "UPSTASH_REDIS_URL",
  "UPSTASH_REDIS_TOKEN",
  "TRIGGER_SECRET_KEY",
  "TRANSLOADIT_KEY",
  "TRANSLOADIT_SECRET",
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("task files import with only the worker's env", async () => {
  for (const name of API_ONLY) vi.stubEnv(name, undefined);
  vi.resetModules();

  await expect(import("@/trigger/agentTurn.task")).resolves.toBeDefined();
  await expect(import("@/trigger/chatTitle.task")).resolves.toBeDefined();
  await expect(import("@/trigger/runSweeper.task")).resolves.toBeDefined();
});
