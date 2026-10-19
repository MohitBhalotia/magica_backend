import { describe, expect, it } from "vitest";

import { newSecret, signedHeaders } from "@/modules/webhooks/signing";

describe("Standard Webhooks signing", () => {
  it("matches the spec's reference signature", () => {
    // The example from https://github.com/standard-webhooks/standard-webhooks (spec.md).
    const headers = signedHeaders(
      "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", // gitleaks:allow (the spec's public example)
      "msg_p5jXN8AQM9LWM0D4loKWxJek",
      '{"test": 2432232314}',
      new Date(1614265330 * 1000),
    );
    expect(headers).toEqual({
      "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
      "webhook-timestamp": "1614265330",
      "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    });
  });

  it("new secrets are whsec_ + 24 random bytes, never the same twice", () => {
    const a = newSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    expect(newSecret()).not.toBe(a);
  });
});
