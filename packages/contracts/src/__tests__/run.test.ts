import { describe, expect, it } from "vitest";

import { RunHandleSchema, RunStatusSchema, TERMINAL_RUN_STATUSES } from "../run.ts";

describe("RunStatusSchema", () => {
  it("terminal statuses are a subset of the lifecycle", () => {
    for (const status of TERMINAL_RUN_STATUSES) expect(RunStatusSchema.parse(status)).toBe(status);
  });
});

describe("RunHandleSchema", () => {
  it("accepts a dispatched run and an undispatched one", () => {
    const base = { runId: "r1", status: "thinking" };
    expect(
      RunHandleSchema.parse({ ...base, triggerRunId: "run_1", publicAccessToken: "pk" })
        .triggerRunId,
    ).toBe("run_1");
    expect(
      RunHandleSchema.parse({ ...base, triggerRunId: null, publicAccessToken: null })
        .publicAccessToken,
    ).toBeNull();
  });

  it("rejects an unknown status", () => {
    const run = { runId: "r1", status: "paused", triggerRunId: null, publicAccessToken: null };
    expect(RunHandleSchema.safeParse(run).success).toBe(false);
  });
});
