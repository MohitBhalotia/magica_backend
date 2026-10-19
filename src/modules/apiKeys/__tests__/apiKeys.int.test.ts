import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rateLimiter";
import { apiKeyService } from "@/modules/apiKeys/apiKey.service";

vi.mock("@/lib/rateLimiter", () => ({ enforceRateLimit: vi.fn() }));

let userId: string;
beforeEach(() => {
  userId = `user_test_${randomUUID()}`;
  vi.clearAllMocks();
});

describe("API keys", () => {
  it("a new key is shown once; only its hash is stored, and it signs its owner in", async () => {
    const { apiKey, key } = await apiKeyService.create(userId, "CI");

    expect(key).toMatch(/^ak_[\w-]{43}$/);
    expect(apiKey).toMatchObject({ name: "CI", prefix: key.slice(0, 10), lastUsedAt: null });
    const row = await db.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(row.hash).not.toContain(key);
    expect(JSON.stringify(row)).not.toContain(key);

    await expect(apiKeyService.authenticate(key)).resolves.toBe(userId);
    expect(enforceRateLimit).toHaveBeenCalledWith("public", apiKey.id);
    const used = await db.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(used.lastUsedAt).not.toBeNull();
  });

  it("an unknown or revoked key is UNAUTHENTICATED, with the same message", async () => {
    const { apiKey, key } = await apiKeyService.create(userId, "old");
    await apiKeyService.revoke(apiKey.id, userId);

    const unknown = apiKeyService.authenticate(`ak_${"x".repeat(43)}`);
    await expect(unknown).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(apiKeyService.authenticate(key)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: "That API key isn't valid.",
    });
  });

  it("lists only the user's live keys, newest first, in pages", async () => {
    const first = await apiKeyService.create(userId, "one");
    const second = await apiKeyService.create(userId, "two");
    const revoked = await apiKeyService.create(userId, "gone");
    await apiKeyService.revoke(revoked.apiKey.id, userId);
    await apiKeyService.create(`user_test_${randomUUID()}`, "someone else's");

    const page1 = await apiKeyService.list(userId, 1);
    expect(page1.items.map((k) => k.id)).toEqual([second.apiKey.id]);
    const page2 = await apiKeyService.list(userId, 1, page1.nextCursor ?? undefined);
    expect(page2).toEqual({ items: [first.apiKey], nextCursor: null });
  });

  it("someone else's key can't be revoked: NOT_FOUND, and it keeps working", async () => {
    const { apiKey, key } = await apiKeyService.create(userId, "mine");

    await expect(apiKeyService.revoke(apiKey.id, "user_other")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(apiKeyService.authenticate(key)).resolves.toBe(userId);
  });
});
