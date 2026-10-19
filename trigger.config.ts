import { additionalFiles, syncEnvVars } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
import { defineConfig } from "@trigger.dev/sdk";
import { config } from "dotenv";

// The worker's runtime secrets (workerEnv.ts). On `trigger deploy` they come from the CI step's env
// (GitHub secrets) and are pushed to the Trigger.dev environment, so nothing is pasted by hand.
const WORKER_SECRETS = ["DATABASE_URL", "OPENROUTER_API_KEY"] as const;

// Load .env.local for local CLI runs; CI sets real env vars.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  // From env (local .env.local / CI var). Trigger.dev also re-imports this file inside its build
  // container to index tasks, where the var is absent and the ref isn't used, so don't throw.
  project: process.env.TRIGGER_PROJECT_REF ?? "",
  dirs: ["./src/trigger"],
  // Run dev workers from the build dir, like production, so `agent-skills/` resolves the same way.
  legacyDevProcessCwdBehaviour: false,
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
  build: {
    extensions: [
      // Prisma 7 `prisma-client` generator: we run `prisma generate` (postinstall); the extension
      // keeps @prisma/client external so the generated client and pg adapter bundle cleanly.
      prismaExtension({ mode: "modern" }),
      // Skills ship inside the worker image at the same relative path (src/agent/tools/skills.ts).
      additionalFiles({ files: ["./agent-skills/**"] }),
      syncEnvVars(() =>
        WORKER_SECRETS.flatMap((name) => {
          const value = process.env[name];
          return value ? [{ name, value, isSecret: true }] : [];
        }),
      ),
    ],
  },
});
