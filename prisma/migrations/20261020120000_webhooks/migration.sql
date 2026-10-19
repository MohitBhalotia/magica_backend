-- M7 outbound webhooks (PRD §6.8): users' endpoints and the delivery outbox.
-- Forward: pnpm db:deploy. Additive only: one enum and two new tables; no existing rows change.
-- Rollback: DROP TABLE "webhook_deliveries"; DROP TABLE "webhook_endpoints";
--           DROP TYPE "delivery_status"; then delete this migration's row from _prisma_migrations.
-- Compat: code from before this migration never reads or writes these tables.
-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMP(3),

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_endpoints_user_id_created_at_id_idx" ON "webhook_endpoints"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_created_at_idx" ON "webhook_deliveries"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_id_event_id_key" ON "webhook_deliveries"("endpoint_id", "event_id");

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
