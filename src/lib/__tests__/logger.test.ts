import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { loggerOptions } from "@/lib/logger";

function capture() {
  const lines: string[] = [];
  const log = pino({ ...loggerOptions, level: "info" }, { write: (l: string) => lines.push(l) });
  return { log, output: () => lines.join("") };
}

describe("logger redaction", () => {
  it("censors secret keys at the top level and one level deep", () => {
    const { log, output } = capture();
    log.info({ token: "tok-1", headers: { authorization: "Bearer abc" }, chatId: "c1" }, "x");
    expect(output()).not.toContain("tok-1");
    expect(output()).not.toContain("Bearer abc");
    expect(output()).toContain("[redacted]");
    expect(output()).toContain("c1");
  });
});
