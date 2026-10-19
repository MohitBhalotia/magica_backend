import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

// Redis holds ephemeral counters only (DEC-006): never locks, idempotency, credits or messages.
const redis = new Redis({ url: env.UPSTASH_REDIS_URL, token: env.UPSTASH_REDIS_TOKEN });

const limiters = {
  send: new Ratelimit({
    redis,
    prefix: "rl:send",
    limiter: Ratelimit.slidingWindow(20, "1 m"),
    // On a slow Redis the request passes: rate limits protect capacity, not data.
    timeout: 1000,
  }),
  /** Every request made with an API key, per key (sends also count against `send`). */
  public: new Ratelimit({
    redis,
    prefix: "rl:public",
    limiter: Ratelimit.slidingWindow(60, "1 m"),
    timeout: 1000,
  }),
} satisfies Record<string, Ratelimit>;

export type RateLimitBucket = keyof typeof limiters;

/** Consumes one token for `key` in `bucket`; throws RATE_LIMITED with `retryAfterSeconds` when exhausted. */
export async function enforceRateLimit(bucket: RateLimitBucket, key: string): Promise<void> {
  const { success, reset } = await limiters[bucket].limit(key);
  if (success) return;
  const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  throw new AppError("RATE_LIMITED", "You're sending too fast. Please wait a moment.", {
    retryAfterSeconds,
  });
}
