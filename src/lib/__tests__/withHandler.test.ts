import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ErrorEnvelopeSchema } from "@mohitbhalotia/magica-contracts";

import { AppError } from "@/lib/errors";
import { withHandler, withPublicHandler } from "@/lib/withHandler";

const { auth } = vi.hoisted(() => ({ auth: vi.fn<() => Promise<{ userId: string | null }>>() }));
vi.mock("@clerk/nextjs/server", () => ({ auth }));

const req = new Request("http://localhost/api/v1/x");
const route = { params: Promise.resolve({}) };

async function call(handler: ReturnType<typeof withPublicHandler>) {
  const res = await handler(req, route);
  const body: unknown = await res.json();
  return { res, body };
}

describe("withHandler", () => {
  it("passes userId and traceId to the handler and echoes x-trace-id", async () => {
    auth.mockResolvedValue({ userId: "user_1" });
    const { res, body } = await call(
      withHandler((_req, ctx) => NextResponse.json({ userId: ctx.userId, traceId: ctx.traceId })),
    );
    expect(body).toEqual({ userId: "user_1", traceId: res.headers.get("x-trace-id") });
  });

  it("returns 401 UNAUTHENTICATED before the handler runs when signed out", async () => {
    auth.mockResolvedValue({ userId: null });
    const handler = vi.fn();
    const { res, body } = await call(withHandler(handler));
    expect(res.status).toBe(401);
    expect(ErrorEnvelopeSchema.parse(body).error.code).toBe("UNAUTHENTICATED");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("withPublicHandler error mapping", () => {
  it("maps AppError to its status and keeps details", async () => {
    const { res, body } = await call(
      withPublicHandler(() => {
        throw new AppError("RUN_ACTIVE", "A response is already in progress.", { runId: "r1" });
      }),
    );
    expect(res.status).toBe(409);
    const { error } = ErrorEnvelopeSchema.parse(body);
    expect(error).toMatchObject({ code: "RUN_ACTIVE", details: { runId: "r1" } });
    expect(error.traceId).toBe(res.headers.get("x-trace-id"));
  });

  it("maps ZodError to 400 VALIDATION_FAILED with field paths", async () => {
    const { res, body } = await call(
      withPublicHandler(() => {
        z.object({ title: z.string() }).parse({ title: 1 });
        return NextResponse.json({});
      }),
    );
    expect(res.status).toBe(400);
    const { error } = ErrorEnvelopeSchema.parse(body);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.details).toMatchObject({ issues: [{ path: "title" }] });
  });

  it("maps unknown errors to 500 INTERNAL without leaking the message", async () => {
    const { res, body } = await call(
      withPublicHandler(() => {
        throw new Error("db password=hunter2 exploded");
      }),
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(ErrorEnvelopeSchema.parse(body).error.code).toBe("INTERNAL");
  });

  it("sets Retry-After for rate-limit errors", async () => {
    const { res } = await call(
      withPublicHandler(() => {
        throw new AppError("RATE_LIMITED", "Slow down.", { retryAfterSeconds: 12 });
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
  });
});
