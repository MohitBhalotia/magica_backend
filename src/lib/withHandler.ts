import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorStatus, type ErrorEnvelope } from "@agent-chat/contracts";

import { requireUserId } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { logger, type Logger } from "@/lib/logger";

type RouteContext<P> = { params: Promise<P> };
type BaseCtx<P> = { traceId: string; logger: Logger; params: Promise<P> };
type Handler<C> = (req: Request, ctx: C) => Promise<Response> | Response;

/** Wraps a signed-in route: resolves userId, adds traceId + child logger, maps every error to the envelope. */
export function withHandler<P = Record<string, never>>(
  handler: Handler<BaseCtx<P> & { userId: string }>,
) {
  return wrap<P>(async (req, ctx) => handler(req, { ...ctx, userId: await requireUserId() }));
}

/** Same as withHandler but without auth (health, webhooks: they verify signatures themselves). */
export function withPublicHandler<P = Record<string, never>>(handler: Handler<BaseCtx<P>>) {
  return wrap<P>(handler);
}

function wrap<P>(handler: Handler<BaseCtx<P>>) {
  return async (req: Request, route: RouteContext<P>): Promise<Response> => {
    const traceId = randomUUID();
    const log = logger.child({ traceId });
    try {
      const res = await handler(req, { traceId, logger: log, params: route.params });
      res.headers.set("x-trace-id", traceId);
      return res;
    } catch (err) {
      return toErrorResponse(err, traceId, log);
    }
  };
}

/** The only place errors become HTTP responses (RULES §6). Unknown errors never leak details. */
export function toErrorResponse(err: unknown, traceId: string, log: Logger): Response {
  const appError =
    err instanceof AppError
      ? err
      : err instanceof ZodError
        ? new AppError("VALIDATION_FAILED", "Some fields are invalid.", {
            issues: err.issues.map(({ path, message }) => ({ path: path.join("."), message })),
          })
        : undefined;

  if (appError) log.warn({ code: appError.code }, appError.message);
  else log.error({ err }, "unhandled error");

  const { code, message, details } = appError ?? {
    code: "INTERNAL" as const,
    message: "Something went wrong. Please try again.",
    details: undefined,
  };
  const body: ErrorEnvelope = { error: { code, message, details, traceId } };
  const headers = new Headers({ "x-trace-id": traceId });
  if (typeof details?.retryAfterSeconds === "number") {
    headers.set("retry-after", String(details.retryAfterSeconds));
  }
  return NextResponse.json(body, { status: errorStatus[code], headers });
}
