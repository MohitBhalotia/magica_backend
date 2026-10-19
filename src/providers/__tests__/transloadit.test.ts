import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { isSignedByTransloadit, uploadOptions } from "@/providers/transloadit";

// TRANSLOADIT_SECRET is the test value from vitest.config.ts.
const sign = (payload: string, secret = "tl_test_secret") =>
  `sha256:${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;

describe("uploadOptions", () => {
  const options = uploadOptions({
    attachmentId: "att_1",
    key: "uploads/user_1/att_1",
    notifyUrl: "https://api.test/api/webhooks/transloadit",
  });
  const params = JSON.parse(options.params) as {
    auth: { key: string; expires: string };
    steps: Record<string, Record<string, unknown>>;
    fields: Record<string, string>;
    notify_url: string;
  };

  it("filters to media, stores in R2 at the fixed key, and carries the attachment id", () => {
    expect(params.steps.accepted).toMatchObject({ robot: "/file/filter", use: ":original" });
    expect(params.steps.stored).toMatchObject({
      robot: "/cloudflare/store",
      use: "accepted",
      credentials: "magica-uploads",
      path: "uploads/user_1/att_1",
    });
    expect(params.fields).toEqual({ attachment_id: "att_1" });
    expect(params.notify_url).toBe("https://api.test/api/webhooks/transloadit");
    expect(Date.parse(params.auth.expires)).toBeGreaterThan(Date.now());
  });

  it("is signed with sha256 under our secret, and the secret isn't in the params", () => {
    expect(options.signature).toBe(sign(options.params));
    expect(options.params).not.toContain("tl_test_secret");
  });
});

describe("isSignedByTransloadit", () => {
  const payload = JSON.stringify({ assembly_id: "a1", ok: "ASSEMBLY_COMPLETED" });

  it("accepts our signature and rejects a forged or tampered one", () => {
    expect(isSignedByTransloadit(payload, sign(payload))).toBe(true);
    expect(isSignedByTransloadit(payload, sign(payload, "someone_else"))).toBe(false);
    expect(isSignedByTransloadit(`${payload} `, sign(payload))).toBe(false);
    expect(isSignedByTransloadit(payload, "sha256:short")).toBe(false);
  });
});
