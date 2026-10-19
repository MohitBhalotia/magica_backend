import { createHmac, randomUUID } from "node:crypto";

import { tasks } from "@trigger.dev/sdk";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebhookEvent } from "@mohitbhalotia/magica-contracts";

import { db } from "@/lib/db";
import { webhookService } from "@/modules/webhooks/webhook.service";

vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: vi.fn(() => Promise.resolve({ id: "trig" })) },
}));

// A public IP literal: the SSRF guard passes it without a DNS lookup; MSW plays the receiver.
const HOOK = "https://8.8.8.8/hook";
const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => {
  server.close();
});

let userId: string;
beforeEach(() => {
  userId = `user_test_${randomUUID()}`;
});

const event = (type: WebhookEvent["type"] = "agent.completed"): WebhookEvent => ({
  id: `evt_${randomUUID()}`,
  type,
  createdAt: new Date().toISOString(),
  data: { runId: "r1", chatId: "c1", status: "completed" },
});

/** The receiver: records what it got and answers with `statuses` in turn. */
function receiver(...statuses: number[]) {
  const got: { body: string; headers: Headers }[] = [];
  server.use(
    http.post(HOOK, async ({ request }) => {
      got.push({ body: await request.text(), headers: request.headers });
      return new HttpResponse(null, { status: statuses.shift() ?? 200 });
    }),
  );
  return got;
}

describe("webhooks", () => {
  it("an event becomes one delivery per subscribed endpoint, once, however often it's emitted", async () => {
    const all = await webhookService.create(userId, {
      url: HOOK,
      events: ["agent.completed", "agent.failed"],
    });
    await webhookService.create(userId, { url: HOOK, events: ["tool.completed"] });
    const e = event();

    const first = await webhookService.emit(userId, e);
    const again = await webhookService.emit(userId, e);

    expect(first).toHaveLength(1);
    expect(again).toEqual(first);
    const rows = await db.webhookDelivery.findMany({ where: { eventId: e.id } });
    expect(rows.map((r) => r.endpointId)).toEqual([all.endpoint.id]);
  });

  it("a deleted endpoint gets nothing, and isn't listed", async () => {
    const { endpoint } = await webhookService.create(userId, {
      url: HOOK,
      events: ["agent.completed"],
    });
    await webhookService.remove(endpoint.id, userId);

    expect(await webhookService.emit(userId, event())).toEqual([]);
    expect((await webhookService.list(userId, 20)).items).toEqual([]);
  });

  it("delivers the event signed for the endpoint's secret, then never again", async () => {
    const { secret } = await webhookService.create(userId, {
      url: HOOK,
      events: ["agent.completed"],
    });
    const e = event();
    const [id] = await webhookService.emit(userId, e);
    const got = receiver(200);

    await expect(webhookService.deliver(id ?? "", false)).resolves.toBe("delivered");
    await expect(webhookService.deliver(id ?? "", false)).resolves.toBe("skipped");

    expect(got).toHaveLength(1);
    const { body, headers } = got[0] ?? { body: "", headers: new Headers() };
    expect(JSON.parse(body)).toEqual(e);
    expect(headers.get("webhook-id")).toBe(e.id);
    const key = Buffer.from(secret.replace("whsec_", ""), "base64");
    const signed = `${headers.get("webhook-id") ?? ""}.${headers.get("webhook-timestamp") ?? ""}.${body}`;
    expect(headers.get("webhook-signature")).toBe(
      `v1,${createHmac("sha256", key).update(signed).digest("base64")}`,
    );
  });

  it("a failing receiver is retried (the try throws); the last failure gives up", async () => {
    await webhookService.create(userId, { url: HOOK, events: ["agent.completed"] });
    const [id = ""] = await webhookService.emit(userId, event());
    receiver(500, 503);

    await expect(webhookService.deliver(id, false)).rejects.toThrow("500");
    expect(await db.webhookDelivery.findUnique({ where: { id } })).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    await expect(webhookService.deliver(id, true)).rejects.toThrow("503");
    expect(await db.webhookDelivery.findUnique({ where: { id } })).toMatchObject({
      status: "failed",
      attempts: 2,
    });
  });

  it("dispatch starts one task per delivery, keyed so a repeat can't send twice", async () => {
    await webhookService.create(userId, { url: HOOK, events: ["agent.completed"] });
    const ids = await webhookService.emit(userId, event());
    await webhookService.dispatch(ids);

    expect(tasks.trigger).toHaveBeenCalledWith(
      "webhook-deliver",
      { deliveryId: ids[0] },
      { idempotencyKey: `webhook:${ids[0] ?? ""}` },
    );
  });

  it("refuses endpoints on private addresses", async () => {
    await expect(
      webhookService.create(userId, { url: "https://10.0.0.5/hook", events: ["agent.completed"] }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("test sends a ping to that endpoint only; someone else's endpoint is NOT_FOUND", async () => {
    const { endpoint } = await webhookService.create(userId, {
      url: HOOK,
      events: ["agent.completed"],
    });

    const ping = await webhookService.test(endpoint.id, userId);
    expect(ping.type).toBe("ping");
    expect(tasks.trigger).toHaveBeenCalledOnce();
    await expect(webhookService.test(endpoint.id, "user_other")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
