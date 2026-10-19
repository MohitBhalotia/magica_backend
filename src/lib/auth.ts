import { auth } from "@clerk/nextjs/server";

import { API_KEY_PREFIX } from "@mohitbhalotia/magica-contracts";

import { AppError } from "@/lib/errors";
import { apiKeyService } from "@/modules/apiKeys/apiKey.service";

/**
 * The caller's user id: from a public API key (`Authorization: Bearer ak_…`, PRD §6.8) or else the
 * Clerk session (cookie or Bearer session token). Throws UNAUTHENTICATED.
 */
export async function requireUserId(req: Request): Promise<string> {
  const key = apiKeyOf(req);
  return key ? apiKeyService.authenticate(key) : requireSessionUserId();
}

/** Signed-in Clerk session only: for what a key mustn't do, like making more keys. */
export async function requireSessionUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  return userId;
}

function apiKeyOf(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  return token?.startsWith(API_KEY_PREFIX) ? token : undefined;
}
