import { describe, expect, it, vi } from "vitest";

import { requireSessionUserId, requireUserId } from "@/lib/auth";
import { AppError } from "@/lib/errors";

const { auth, authenticate } = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<{ userId: string | null }>>(),
  authenticate: vi.fn<(key: string) => Promise<string>>(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth }));
vi.mock("@/modules/apiKeys/apiKey.service", () => ({ apiKeyService: { authenticate } }));

const request = (authorization?: string) =>
  new Request("http://test/api/v1/chats", {
    headers: authorization ? { authorization } : {},
  });

describe("requireUserId", () => {
  it("returns the Clerk user id", async () => {
    auth.mockResolvedValue({ userId: "user_1" });
    await expect(requireUserId(request())).resolves.toBe("user_1");
  });

  it("throws UNAUTHENTICATED when signed out", async () => {
    auth.mockResolvedValue({ userId: null });
    await expect(requireUserId(request())).rejects.toMatchObject(
      new AppError("UNAUTHENTICATED", "Please sign in to continue."),
    );
  });

  it("an API key is checked as a key, never as a Clerk session", async () => {
    authenticate.mockResolvedValue("user_key");
    await expect(requireUserId(request("Bearer ak_abc"))).resolves.toBe("user_key");
    expect(authenticate).toHaveBeenCalledWith("ak_abc");
    expect(auth).not.toHaveBeenCalled();
  });

  it("a Bearer session token still goes to Clerk", async () => {
    auth.mockResolvedValue({ userId: "user_1" });
    await expect(requireUserId(request("Bearer eyJhbGciOi.x.y"))).resolves.toBe("user_1");
    expect(authenticate).not.toHaveBeenCalled();
  });
});

describe("requireSessionUserId", () => {
  it("ignores API keys: only a signed-in session counts", async () => {
    auth.mockResolvedValue({ userId: null });
    await expect(requireSessionUserId()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(authenticate).not.toHaveBeenCalled();
  });
});
