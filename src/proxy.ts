import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { corsHeaders } from "@/lib/cors";
import { env } from "@/lib/env";

// Attaches auth state only; each handler enforces it via requireUserId(), so webhooks and health
// stay public. Also answers CORS for the allow-listed frontend origins.
export default clerkMiddleware(
  (_auth, req) => {
    const headers = corsHeaders(req.headers.get("origin"), env.FRONTEND_ORIGINS);
    if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
    return NextResponse.next({ headers });
  },
  { authorizedParties: env.FRONTEND_ORIGINS },
);

export const config = { matcher: ["/api/(.*)"] };
