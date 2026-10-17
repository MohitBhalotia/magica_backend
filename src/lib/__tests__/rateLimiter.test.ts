import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimiter";

const { limit } = vi.hoisted(() => ({
  limit: vi.fn<(key: string) => Promise<{ success: boolean; reset: number }>>(),
}));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(
    vi.fn(function () {
      return { limit };
    }),
    { slidingWindow: vi.fn() },
  ),
}));

describe("enforceRateLimit", () => {
  beforeEach(() => limit.mockReset());

  it("passes while under the limit", async () => {
    limit.mockResolvedValue({ success: true, reset: Date.now() });
    await expect(enforceRateLimit("send", "user_1")).resolves.toBeUndefined();
    expect(limit).toHaveBeenCalledWith("user_1");
  });

  it("throws RATE_LIMITED with retryAfterSeconds when exhausted", async () => {
    limit.mockResolvedValue({ success: false, reset: Date.now() + 9_500 });
    const err: unknown = await enforceRateLimit("send", "user_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "RATE_LIMITED", details: { retryAfterSeconds: 10 } });
  });
});
