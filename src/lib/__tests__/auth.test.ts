import { describe, expect, it, vi } from "vitest";

import { requireUserId } from "@/lib/auth";
import { AppError } from "@/lib/errors";

const { auth } = vi.hoisted(() => ({ auth: vi.fn<() => Promise<{ userId: string | null }>>() }));
vi.mock("@clerk/nextjs/server", () => ({ auth }));

describe("requireUserId", () => {
  it("returns the Clerk user id", async () => {
    auth.mockResolvedValue({ userId: "user_1" });
    await expect(requireUserId()).resolves.toBe("user_1");
  });

  it("throws UNAUTHENTICATED when signed out", async () => {
    auth.mockResolvedValue({ userId: null });
    await expect(requireUserId()).rejects.toMatchObject(
      new AppError("UNAUTHENTICATED", "Please sign in to continue."),
    );
  });
});
