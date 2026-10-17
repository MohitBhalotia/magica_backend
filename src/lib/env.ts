import { z } from "zod";

// Keys become required in the milestone that first uses them (see .env.example).
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  // Brief: OpenRouter Free only, no paid fallback. Any other value fails boot.
  OPENROUTER_MODEL: z.literal("openrouter/free").default("openrouter/free"),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  // Read directly by @clerk/nextjs; validated here so a missing key fails at boot.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  // Comma-separated frontend origins allowed to send Clerk session tokens.
  FRONTEND_ORIGINS: z
    .string()
    .transform((v) => v.split(",").map((o) => o.trim()))
    .pipe(z.array(z.url()).min(1)),
  // Neon pooled endpoint for the app (DEC-016). DIRECT_URL is CLI-only (prisma.config.ts).
  DATABASE_URL: z.url(),
  // Upstash REST endpoint: rate-limit counters only (DEC-006).
  UPSTASH_REDIS_URL: z.url(),
  UPSTASH_REDIS_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
