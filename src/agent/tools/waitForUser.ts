import { metadata, wait } from "@trigger.dev/sdk";

import {
  WAITPOINT_METADATA_KEY,
  WAITPOINTS,
  type WaitpointRequest,
  type WaitpointResponse,
  type WaitpointType,
} from "@mohitbhalotia/magica-contracts";

import type { ToolContext } from "@/agent/tools/define";
import { untilStopped } from "@/agent/tools/magicaRun";
import { AppError } from "@/lib/errors";
import { runRepository } from "@/modules/runs/run.repository";
import { toWaitpoint, waitpointRepository } from "@/modules/waitpoints/waitpoint.repository";

/** How long a question stays open (PRD §5.8). */
const TIMEOUT = "15m";
const TIMEOUT_MS = 15 * 60_000;

/**
 * Pauses the run until the user answers (PRD §5.8):
 * 1. save the question (once per tool call and type, so a retried call reuses it);
 * 2. mark the run waiting and show the question in the browser (run metadata);
 * 3. wait on a Trigger.dev token, which costs no compute, until the answer or the timeout;
 * 4. read the answer from Postgres (the API records it there before completing the token).
 * A question nobody answers expires; Stop cancels it.
 */
export async function waitForUser<T extends WaitpointType>(
  ctx: ToolContext,
  type: T,
  request: WaitpointRequest<T>,
): Promise<WaitpointResponse<T>> {
  const idempotencyKey = `${ctx.runId}:${ctx.toolCallId}:${type}`;
  const token = await wait.createToken({ idempotencyKey, timeout: TIMEOUT });
  const waitpoint = await waitpointRepository.open({
    userId: ctx.userId,
    chatId: ctx.chatId,
    runId: ctx.runId,
    toolCallId: ctx.toolCallId,
    type,
    request,
    tokenId: token.id,
    idempotencyKey,
    expiresAt: new Date(Date.now() + TIMEOUT_MS),
  });

  if (waitpoint.status === "pending") {
    await runRepository.setWaiting(ctx.runId, true);
    metadata.set(WAITPOINT_METADATA_KEY, toWaitpoint(waitpoint));
    // The browser must see the question before the run pauses.
    await metadata.flush();
    try {
      const result = await untilStopped(wait.forToken(token), ctx.signal);
      if (!result.ok) await waitpointRepository.close(waitpoint.id, "expired");
    } catch (err) {
      if (ctx.signal?.aborted) await waitpointRepository.close(waitpoint.id, "cancelled");
      throw err;
    } finally {
      metadata.del(WAITPOINT_METADATA_KEY);
      await metadata.flush();
      await runRepository.setWaiting(ctx.runId, false);
    }
  }

  const answered = await waitpointRepository.get(waitpoint.id);
  if (answered.status !== "answered") {
    throw new AppError(
      "WAITPOINT_EXPIRED",
      "I paused for your answer but didn't hear back. Reply here to continue.",
    );
  }
  return WAITPOINTS[type].response.parse(answered.response) as WaitpointResponse<T>;
}
