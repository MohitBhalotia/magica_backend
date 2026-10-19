import { describe, expect, it } from "vitest";

import { assertPublicUrl } from "@/modules/webhooks/publicUrl";

describe("assertPublicUrl (SSRF guard)", () => {
  it.each([
    "http://8.8.8.8/hook",
    "https://127.0.0.1/hook",
    "https://10.1.2.3/hook",
    "https://172.20.0.1/hook",
    "https://192.168.1.10/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/hook",
    "https://[fd00::1]/hook",
    "https://[::ffff:10.0.0.1]/hook",
    "https://localhost/hook",
  ])("refuses %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("allows a public HTTPS address", async () => {
    await expect(assertPublicUrl("https://8.8.8.8/hook")).resolves.toBeUndefined();
  });
});
