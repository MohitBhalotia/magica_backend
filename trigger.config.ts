import { defineConfig } from "@trigger.dev/sdk";
import { config } from "dotenv";

// Load .env.local for local CLI runs; CI sets real env vars.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  // From env (local .env.local / CI var). Trigger.dev also re-imports this file inside its build
  // container to index tasks, where the var is absent and the ref isn't used, so don't throw.
  project: process.env.TRIGGER_PROJECT_REF ?? "",
  dirs: ["./src/trigger"],
  // Agent turns can wait minutes on tools and approvals; waits don't count toward this (checkpointed).
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
});
