-- M3 tools & skills (DEC-054): tool_invocations, run_skills, assets, and the credit_ledger.invocation_id FK.
-- Forward: pnpm db:deploy. Additive only: new enums and tables, plus one FK on credit_ledger.invocation_id,
--          which is NULL in every existing row (no tools ran before M3), so it applies without a backfill.
-- Rollback: ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_invocation_id_fkey";
--           DROP TABLE "assets", "run_skills", "tool_invocations"; DROP TYPE "asset_kind", "tool_state";
--           then delete this migration's row from _prisma_migrations.
-- Compat: code from before M3 never reads or writes these tables.
-- CreateEnum
CREATE TYPE "tool_state" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "asset_kind" AS ENUM ('image', 'video');

-- CreateTable
CREATE TABLE "tool_invocations" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "tool_call_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "state" "tool_state" NOT NULL DEFAULT 'pending',
    "input_sanitized" JSONB NOT NULL,
    "output" JSONB,
    "magica_run_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,

    CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_skills" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "skill_name" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "loaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "invocation_id" TEXT NOT NULL,
    "kind" "asset_kind" NOT NULL,
    "url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "size_bytes" BIGINT,
    "prompt" TEXT,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tool_invocations_magica_run_id_key" ON "tool_invocations"("magica_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "tool_invocations_run_id_tool_call_id_key" ON "tool_invocations"("run_id", "tool_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_skills_run_id_skill_name_key" ON "run_skills"("run_id", "skill_name");

-- CreateIndex
CREATE INDEX "assets_chat_id_created_at_id_idx" ON "assets"("chat_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_invocation_id_fkey" FOREIGN KEY ("invocation_id") REFERENCES "tool_invocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_skills" ADD CONSTRAINT "run_skills_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_chat_id_user_id_fkey" FOREIGN KEY ("chat_id", "user_id") REFERENCES "chats"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_invocation_id_fkey" FOREIGN KEY ("invocation_id") REFERENCES "tool_invocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
