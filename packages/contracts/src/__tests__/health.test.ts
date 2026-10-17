import { describe, expect, it } from "vitest";

import { HealthResponseSchema } from "../health.js";

describe("HealthResponseSchema", () => {
  it("accepts an ISO timestamp", () => {
    expect(HealthResponseSchema.parse({ status: "ok", time: "2026-10-17T00:00:00Z" }).status).toBe(
      "ok",
    );
  });

  it("rejects a non-ISO timestamp", () => {
    expect(HealthResponseSchema.safeParse({ status: "ok", time: "now" }).success).toBe(false);
  });
});
