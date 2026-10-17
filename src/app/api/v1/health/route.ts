import { NextResponse } from "next/server";

import type { HealthResponse } from "@agent-chat/contracts";

import { withPublicHandler } from "@/lib/withHandler";

export const GET = withPublicHandler(() =>
  NextResponse.json<HealthResponse>({ status: "ok", time: new Date().toISOString() }),
);
