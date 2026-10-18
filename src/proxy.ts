import { clerkMiddleware } from "@clerk/nextjs/server";

import { env } from "@/lib/env";

// Attaches auth state only; each handler enforces it via requireUserId(), so webhooks and health stay public.
export default clerkMiddleware({ authorizedParties: env.FRONTEND_ORIGINS });

export const config = { matcher: ["/api/(.*)"] };
