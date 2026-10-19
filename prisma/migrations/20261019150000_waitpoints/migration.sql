-- M4b waitpoints (DEC-055, PRD §5.8): a run paused on the user (credit approval, options, plan approval).
-- Forward: pnpm db:deploy. Additive only: two new enums and one new table; no existing rows change.
-- Rollback: DROP TABLE "waitpoints"; DROP TYPE "waitpoint_status", "waitpoint_type";
--           then delete this migration's row from _prisma_migrations.
-- Compat: code from before M4b never reads or writes this table.
-- CreateEnum
CREATE TYPE "waitpoint_type" AS ENUM ('credit_approval', 'options', 'plan_approval');

-- CreateEnum
CREATE TYPE "waitpoint_status" AS ENUM ('pending', 'answered', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "waitpoints" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "tool_call_id" TEXT NOT NULL,
    "type" "waitpoint_type" NOT NULL,
    "status" "waitpoint_status" NOT NULL DEFAULT 'pending',
    "request" JSONB NOT NULL,
    "response" JSONB,
    "token_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "answered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waitpoints_idempotency_key_key" ON "waitpoints"("idempotency_key");

-- CreateIndex
CREATE INDEX "waitpoints_run_id_status_idx" ON "waitpoints"("run_id", "status");

-- AddForeignKey
ALTER TABLE "waitpoints" ADD CONSTRAINT "waitpoints_chat_id_user_id_fkey" FOREIGN KEY ("chat_id", "user_id") REFERENCES "chats"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitpoints" ADD CONSTRAINT "waitpoints_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
