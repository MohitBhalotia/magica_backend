import { NextResponse } from "next/server";

import { withPublicHandler } from "@/lib/withHandler";

// The bare base URL answers too, so opening it in a browser shows where to go instead of a 404.
export const GET = withPublicHandler(() =>
  NextResponse.json({
    name: "Magica Agent API",
    version: "v1",
    docs: "https://magica-ebc2eaac.mintlify.site",
    health: "/api/v1/health",
    auth: "Authorization: Bearer ak_… (API keys: app user menu → API keys)",
  }),
);
