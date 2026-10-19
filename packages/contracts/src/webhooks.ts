import { z } from "zod";

import { pageSchema } from "./pagination.ts";
import { RunStatusSchema } from "./run.ts";

/**
 * Outbound webhook events (PRD §6.8, brief "Outbound Webhooks"). `ping` is only ever sent by
 * `POST /webhooks/{id}/test`.
 */
export const WEBHOOK_EVENTS = [
  "agent.started",
  "agent.completed",
  "agent.failed",
  "tool.completed",
] as const;
export const WebhookEventTypeSchema = z.enum([...WEBHOOK_EVENTS, "ping"]);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

/**
 * The body we POST, signed with the Standard Webhooks scheme (`webhook-id`, `webhook-timestamp`,
 * `webhook-signature` headers). `id` is the same on every retry of one event: dedupe on it.
 * No message text and no file links: fetch them with the API if you need them.
 */
export const WebhookEventSchema = z.object({
  id: z.string(),
  type: WebhookEventTypeSchema,
  createdAt: z.iso.datetime(),
  data: z.object({
    chatId: z.string().optional(),
    runId: z.string().optional(),
    /** The run's status (agent events), or the tool call's (`tool.completed`). */
    status: z.union([RunStatusSchema, z.literal("succeeded")]).optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
    tool: z.string().optional(),
    toolCallId: z.string().optional(),
    creditsUsedMicro: z.number().optional(),
  }),
});
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

/** A registered endpoint, as listed: never its secret. */
export const WebhookEndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(WebhookEventTypeSchema),
  createdAt: z.iso.datetime(),
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;

export const WebhookEndpointListSchema = pageSchema(WebhookEndpointSchema);
export type WebhookEndpointList = z.infer<typeof WebhookEndpointListSchema>;

/** `POST /webhooks`: a public HTTPS URL and the events to send it (all of them by default). */
export const CreateWebhookRequestSchema = z.object({
  url: z.url({ protocol: /^https$/ }).max(2048),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1)
    .default([...WEBHOOK_EVENTS]),
});
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>;

/** The new endpoint and its signing secret (`whsec_…`), shown once. */
export const CreateWebhookResponseSchema = z.object({
  endpoint: WebhookEndpointSchema,
  secret: z.string(),
});
export type CreateWebhookResponse = z.infer<typeof CreateWebhookResponseSchema>;
