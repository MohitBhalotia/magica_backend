import { NextResponse } from "next/server";

import {
  CreateWebhookRequestSchema,
  PageQuerySchema,
  type CreateWebhookResponse,
  type WebhookEndpointList,
  type WebhookEvent,
} from "@mohitbhalotia/magica-contracts";

import { withHandler } from "@/lib/withHandler";
import { webhookService } from "@/modules/webhooks/webhook.service";

type Params = { webhookId: string };

export const listWebhooks = withHandler(async (req, { userId }) => {
  const { limit, cursor } = PageQuerySchema.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  return NextResponse.json<WebhookEndpointList>(await webhookService.list(userId, limit, cursor));
});

/** Registers an endpoint; its signing secret is in this response only. */
export const createWebhook = withHandler(async (req, { userId }) => {
  const body = CreateWebhookRequestSchema.parse(await req.json());
  return NextResponse.json<CreateWebhookResponse>(await webhookService.create(userId, body), {
    status: 201,
  });
});

export const deleteWebhook = withHandler<Params>(async (_req, { userId, params }) => {
  await webhookService.remove((await params).webhookId, userId);
  return new NextResponse(null, { status: 204 });
});

/** Sends a signed `ping` to the endpoint, to check the receiver end to end. */
export const testWebhook = withHandler<Params>(async (_req, { userId, params }) =>
  NextResponse.json<WebhookEvent>(await webhookService.test((await params).webhookId, userId), {
    status: 202,
  }),
);
