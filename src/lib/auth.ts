import { auth } from "@clerk/nextjs/server";

import { AppError } from "@/lib/errors";

/** Returns the signed-in Clerk user id (cookie or Bearer session token) or throws UNAUTHENTICATED. */
export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  return userId;
}
