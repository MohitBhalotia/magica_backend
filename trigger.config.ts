import { defineConfig } from "@trigger.dev/sdk";
import { config } from "dotenv";

// Load .env.local for local CLI runs; CI sets real env vars.
config({ path: ".env.local", quiet: true });

const project = process.env.TRIGGER_PROJECT_REF;
if (!project) throw new Error("TRIGGER_PROJECT_REF is not set (see .env.example)");

export default defineConfig({
  project,
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
