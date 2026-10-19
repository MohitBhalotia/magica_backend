import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ChatCompletionRequestSchema,
  type ChatCompletion,
  type SendResponse,
} from "@mohitbhalotia/magica-contracts";

import { enforceRateLimit } from "@/lib/rateLimiter";
import { withHandler } from "@/lib/withHandler";
import { completionService } from "@/modules/completions/completion.service";

/**
 * `POST /chat/completions` (PRD §6.8). 200 with the answer or an SSE stream; 202 with the run
 * handle when the answer isn't ready (still dispatching, a long generation, an approval).
 */
export const createCompletion = withHandler(async (req, { userId, traceId, logger }) => {
  await enforceRateLimit("send", userId);
  const body = ChatCompletionRequestSchema.parse(await req.json());
  // The key becomes the chat id for a new chat, so it must be a UUID like the app's own ids.
  const idempotencyKey = z
    .uuid()
    .optional()
    .parse(req.headers.get("idempotency-key") ?? undefined);
  const sent = await completionService.start(userId, body, idempotencyKey, { traceId, logger });
  const accepted = () => NextResponse.json<SendResponse>(sent, { status: 202 });

  // Not handed to Trigger.dev yet (the sweeper retries it): nothing to stream or wait on.
  const { triggerRunId } = sent.run;
  if (!triggerRunId) return accepted();
  if (body.stream)
    return new Response(completionService.stream(sent, triggerRunId, req.signal), {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
    });
  const done = await completionService.finish(sent, userId);
  return done ? NextResponse.json<ChatCompletion>(done) : accepted();
});
