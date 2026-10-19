import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { webhookService } from "@/modules/webhooks/webhook.service";

/** Tries per delivery: backoff from 10s to 10min covers about 40 minutes of receiver downtime. */
const MAX_ATTEMPTS = 8;

/** Sends one outbound webhook delivery (PRD §6.8); a failed try throws and is retried. */
export const webhookDeliver = schemaTask({
  id: "webhook-deliver",
  schema: z.object({ deliveryId: z.string() }),
  retry: { maxAttempts: MAX_ATTEMPTS, factor: 2, minTimeoutInMs: 10_000, maxTimeoutInMs: 600_000 },
  run: ({ deliveryId }, { ctx }) =>
    webhookService.deliver(deliveryId, ctx.attempt.number >= MAX_ATTEMPTS),
});
