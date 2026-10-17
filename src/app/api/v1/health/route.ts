import { NextResponse } from "next/server";

import type { HealthResponse } from "@agent-chat/contracts";

export function GET() {
  return NextResponse.json<HealthResponse>({ status: "ok", time: new Date().toISOString() });
}
