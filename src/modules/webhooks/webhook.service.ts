import { tasks } from "@trigger.dev/sdk";

import {
  WebhookEventSchema,
  type CreateWebhookRequest,
  type WebhookEndpoint,
  type WebhookEvent,
} from "@mohitbhalotia/magica-contracts";

import type { DbClient } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { userService } from "@/modules/users/user.service";
import { assertPublicUrl } from "@/modules/webhooks/publicUrl";
import { newSecret, signedHeaders } from "@/modules/webhooks/signing";
import { webhookRepository } from "@/modules/webhooks/webhook.repository";

import type { AgentRun, WebhookEndpoint as EndpointRow } from "../../../prisma/generated/client";

/** A receiver gets this long to answer before the try counts as failed. */
const SEND_TIMEOUT_MS = 10_000;

const toEndpoint = (row: EndpointRow): WebhookEndpoint => ({
  id: row.id,
  url: row.url,
  events: row.events as WebhookEndpoint["events"],
  createdAt: row.createdAt.toISOString(),
});
const notFound = () => new AppError("NOT_FOUND", "Webhook not found.");

/** An agent lifecycle event for a run. Its id is fixed per run and type, so repeats dedupe. */
export function runEvent(
  run: AgentRun,
  type: "agent.started" | "agent.completed" | "agent.failed",
  data: Partial<WebhookEvent["data"]> = {},
): WebhookEvent {
  return {
    id: `evt_${run.id}_${type}`,
    type,
    createdAt: new Date().toISOString(),
    data: { chatId: run.chatId, runId: run.id, ...data },
  };
}

export const webhookService = {
  async create(userId: string, { url, events }: CreateWebhookRequest) {
    await assertPublicUrl(url);
    await userService.ensure(userId);
    const secret = newSecret();
    const row = await webhookRepository.createEndpoint({ userId, url, secret, events });
    return { endpoint: toEndpoint(row), secret };
  },

  async list(userId: string, limit: number, cursor?: string) {
    const page = await webhookRepository.listEndpoints(userId, limit, cursor);
    return { items: page.items.map(toEndpoint), nextCursor: page.nextCursor };
  },

  async remove(id: string, userId: string) {
    const { count } = await webhookRepository.disableEndpoint(id, userId);
    if (count === 0) throw notFound();
  },

  /** `POST /webhooks/{id}/test`: a `ping` to that endpoint alone. */
  async test(id: string, userId: string) {
    const endpoint = await webhookRepository.findEndpoint(id, userId);
    if (!endpoint) throw notFound();
    const event: WebhookEvent = {
      id: `evt_ping_${String(Date.now())}`,
      type: "ping",
      createdAt: new Date().toISOString(),
      data: {},
    };
    await webhookService.dispatch(await webhookRepository.enqueue(userId, event, undefined, id));
    return event;
  },

  /**
   * Writes the event's deliveries in the caller's transaction (the outbox), so an event exists
   * exactly when the change it reports does. Call `dispatch` with the ids after the commit.
   */
  emit: (userId: string, event: WebhookEvent, db?: DbClient) =>
    webhookRepository.enqueue(userId, WebhookEventSchema.parse(event), db),

  /**
   * Starts a delivery task per id (idempotent by delivery id). A delivery whose task never starts
   * stays pending, and the run sweeper starts it a minute later.
   */
  async dispatch(deliveryIds: string[]) {
    await Promise.all(
      deliveryIds.map(async (deliveryId) => {
        try {
          await tasks.trigger(
            "webhook-deliver",
            { deliveryId },
            { idempotencyKey: `webhook:${deliveryId}` },
          );
        } catch {
          // Left pending: the sweeper starts it. A webhook must never fail the run it reports.
        }
      }),
    );
  },

  /**
   * One try at sending a delivery, signed (Standard Webhooks). A 2xx marks it delivered; anything
   * else records the error and throws, so the task retries with backoff. `final`: the last try.
   */
  async deliver(deliveryId: string, final: boolean) {
    const delivery = await webhookRepository.findDelivery(deliveryId);
    if (delivery?.status !== "pending" || delivery.endpoint.disabledAt) return "skipped";
    const body = JSON.stringify(delivery.payload);
    try {
      await assertPublicUrl(delivery.endpoint.url);
      const res = await fetch(delivery.endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Magica-Webhooks/1",
          ...signedHeaders(delivery.endpoint.secret, delivery.eventId, body),
        },
        body,
        // A redirect could lead anywhere: the URL that was checked is the only one we call.
        redirect: "manual",
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`The endpoint answered ${String(res.status)}.`);
      await webhookRepository.markDelivered(deliveryId);
      return "delivered";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delivery failed.";
      await webhookRepository.markFailed(deliveryId, message, final);
      throw err;
    }
  },
};
