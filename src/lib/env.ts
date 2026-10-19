import { z } from "zod";

import { CoreEnvSchema } from "@/lib/coreEnv";
import { R2EnvSchema } from "@/providers/r2";
import { TransloaditEnvSchema } from "@/providers/transloadit";

// API (route handlers) env. Keys become required in the milestone that first uses them (see .env.example).
export const EnvSchema = CoreEnvSchema.extend({
  // Read directly by @clerk/nextjs; validated here so a missing key fails at boot.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  // Comma-separated frontend origins allowed to send Clerk session tokens.
  FRONTEND_ORIGINS: z
    .string()
    .transform((v) => v.split(",").map((o) => o.trim()))
    .pipe(z.array(z.url()).min(1)),
  // Upstash REST endpoint: rate-limit counters only (DEC-006).
  UPSTASH_REDIS_URL: z.url(),
  UPSTASH_REDIS_TOKEN: z.string().min(1),
  // Read by @trigger.dev/sdk to dispatch `agent-turn` and mint run tokens; validated so boot fails early.
  TRIGGER_SECRET_KEY: z.string().startsWith("tr_"),
  // Uploads (M5): Transloadit signs upload jobs (this key requires sha256 signatures); files land in
  // a private R2 bucket and are read through short-lived signed URLs.
  ...TransloaditEnvSchema.shape,
  ...R2EnvSchema.shape,
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
