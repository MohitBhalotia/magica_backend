import { z } from "zod";

import { CoreEnvSchema } from "@/lib/coreEnv";

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
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
