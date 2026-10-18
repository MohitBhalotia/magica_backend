import { describe, expect, it } from "vitest";

import { corsHeaders } from "@/lib/cors";

const allowed = ["https://magica-galaxy-frontend.vercel.app", "http://localhost:3000"];

describe("corsHeaders", () => {
  it("echoes an allow-listed origin with methods, headers and exposed headers", () => {
    const h = corsHeaders("http://localhost:3000", allowed);
    expect(h["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
    expect(h["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(h["Access-Control-Expose-Headers"]).toContain("X-Trace-Id");
    expect(h.Vary).toBe("Origin");
  });

  it("never allows credentials (Bearer auth, no cookies)", () => {
    expect(corsHeaders(allowed[0] ?? "", allowed)).not.toHaveProperty(
      "Access-Control-Allow-Credentials",
    );
  });

  it("returns nothing for unknown or missing origins", () => {
    expect(corsHeaders("https://evil.example", allowed)).toEqual({});
    expect(corsHeaders(null, allowed)).toEqual({});
  });
});
