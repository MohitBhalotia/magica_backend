import type { WebhookEvent } from "@mohitbhalotia/magica-contracts";

import { db as prisma, type DbClient } from "@/lib/db";

import { DeliveryStatus } from "../../../prisma/generated/client";

export const webhookRepository = {
  createEndpoint: (
    data: { userId: string; url: string; secret: string; events: string[] },
    db: DbClient = prisma,
  ) => db.webhookEndpoint.create({ data }),

  /** The user's live endpoints, newest first. */
  async listEndpoints(userId: string, limit: number, cursor?: string, db: DbClient = prisma) {
    const rows = await db.webhookEndpoint.findMany({
      where: { userId, disabledAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  },

  findEndpoint: (id: string, userId: string, db: DbClient = prisma) =>
    db.webhookEndpoint.findFirst({ where: { id, userId, disabledAt: null } }),

  /** Stops sending to an endpoint; 0 when it isn't the user's (or is already off). */
  disableEndpoint: (id: string, userId: string, db: DbClient = prisma) =>
    db.webhookEndpoint.updateMany({
      where: { id, userId, disabledAt: null },
      data: { disabledAt: new Date() },
    }),

  /**
   * The outbox: one pending delivery per endpoint of the user that wants this event type, in the
   * caller's transaction. A repeat of the same event id adds nothing (unique endpoint + event).
   * Returns the ids still waiting to be sent.
   */
  async enqueue(userId: string, event: WebhookEvent, db: DbClient = prisma, endpointId?: string) {
    const endpoints = await db.webhookEndpoint.findMany({
      where: {
        userId,
        disabledAt: null,
        ...(endpointId ? { id: endpointId } : { events: { has: event.type } }),
      },
      select: { id: true },
    });
    if (endpoints.length === 0) return [];
    await db.webhookDelivery.createMany({
      data: endpoints.map((e) => ({
        endpointId: e.id,
        eventId: event.id,
        type: event.type,
        payload: event,
      })),
      skipDuplicates: true,
    });
    const pending = await db.webhookDelivery.findMany({
      where: {
        eventId: event.id,
        status: DeliveryStatus.pending,
        endpointId: { in: endpoints.map((e) => e.id) },
      },
      select: { id: true },
    });
    return pending.map((d) => d.id);
  },

  findDelivery: (id: string, db: DbClient = prisma) =>
    db.webhookDelivery.findUnique({ where: { id }, include: { endpoint: true } }),

  markDelivered: (id: string, db: DbClient = prisma) =>
    db.webhookDelivery.update({
      where: { id },
      data: {
        status: DeliveryStatus.delivered,
        deliveredAt: new Date(),
        attempts: { increment: 1 },
      },
    }),

  /** A failed try; `final` when no retries are left. */
  markFailed: (id: string, error: string, final: boolean, db: DbClient = prisma) =>
    db.webhookDelivery.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastError: error.slice(0, 500),
        ...(final && { status: DeliveryStatus.failed }),
      },
    }),

  /** Sweeper: deliveries still pending after `before` (their task was never started). */
  findStuck: (before: Date, limit: number, db: DbClient = prisma) =>
    db.webhookDelivery.findMany({
      where: { status: DeliveryStatus.pending, attempts: 0, createdAt: { lt: before } },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true },
    }),
};
