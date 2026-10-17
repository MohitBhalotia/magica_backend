import { describe, expect, it } from "vitest";

import { ErrorCodeSchema, ErrorEnvelopeSchema, errorStatus } from "../errors.js";

describe("errors", () => {
  it("maps every error code to an HTTP error status", () => {
    for (const code of ErrorCodeSchema.options) {
      expect(errorStatus[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it("parses a valid envelope", () => {
    const envelope = { error: { code: "NOT_FOUND", message: "Chat not found.", traceId: "t1" } };
    expect(ErrorEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("rejects codes outside the closed set", () => {
    const envelope = { error: { code: "OOPS", message: "x", traceId: "t1" } };
    expect(ErrorEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});
