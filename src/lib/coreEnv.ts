import { z } from "zod";

/**
 * Env shared by the API and the Trigger.dev worker (db, logger). Kept separate from `env.ts` so
 * the worker never needs the API's Clerk, CORS or Upstash vars, and the API never needs the
 * OpenRouter key (`workerEnv.ts`).
 */
export const CoreEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  // Neon pooled endpoint for the app (DEC-016). DIRECT_URL is CLI-only (prisma.config.ts).
  DATABASE_URL: z.url(),
});

export const coreEnv = CoreEnvSchema.parse(process.env);
