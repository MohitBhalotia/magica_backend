-- Core schema v1 (DEC-038): users, credit_accounts, chats, messages, agent_runs, credit_ledger.
-- Forward: pnpm db:deploy (prod/CI) or pnpm db:migrate (dev). Empty DB assumed, no backfill.
-- Rollback: DROP TABLE credit_ledger, agent_runs, messages, credit_accounts, chats, users CASCADE;
--           DROP TYPE ledger_type, run_status, message_status, message_role, title_source;
--           then delete this migration's row from _prisma_migrations. pg_trgm can stay installed.
-- Compat: PostgreSQL 13+ (generated columns, pg_trgm); Neon runs 18. Prisma 7.10 + partialIndexes preview.
-- Hand edits: pg_trgm extension; title_tsv/text_tsv as GENERATED columns (schema: Unsupported("tsvector")).

-- Hand-added: trigram matching for fuzzy/prefix title search (chats_title_trgm_idx).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "title_source" AS ENUM ('placeholder', 'prompt', 'generated', 'user');

-- CreateEnum
CREATE TYPE "message_role" AS ENUM ('user', 'assistant', 'system', 'tool');

-- CreateEnum
CREATE TYPE "message_status" AS ENUM ('pending', 'streaming', 'success', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('queued', 'thinking', 'working', 'waiting', 'stopping', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ledger_type" AS ENUM ('grant', 'reserve', 'release', 'charge', 'refund');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chats" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "title_source" "title_source" NOT NULL DEFAULT 'placeholder',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "pinned_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    -- Hand-edited: generated column so Postgres keeps it in sync with title.
    "title_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "title")) STORED,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "balance_micro" BIGINT NOT NULL DEFAULT 0,
    "monthly_upload_bytes" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "message_role" NOT NULL,
    "status" "message_status" NOT NULL DEFAULT 'pending',
    "content_blocks" JSONB NOT NULL DEFAULT '[]',
    "text" TEXT NOT NULL DEFAULT '',
    "client_message_id" TEXT,
    "run_id" TEXT,
    "credit_used_micro" BIGINT NOT NULL DEFAULT 0,
    "token_usage" JSONB,
    "routed_model" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    -- Hand-edited: generated column so Postgres keeps it in sync with text.
    "text_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_message_id" TEXT NOT NULL,
    "assistant_message_id" TEXT NOT NULL,
    "status" "run_status" NOT NULL DEFAULT 'queued',
    "trigger_run_id" TEXT,
    "dispatch_key" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "routed_model" TEXT,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "thinking_ms" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "trace_id" TEXT NOT NULL,
    "dispatch_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" "ledger_type" NOT NULL,
    "amount_micro" BIGINT NOT NULL,
    "run_id" TEXT,
    "invocation_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chats_user_id_is_pinned_updated_at_id_idx" ON "chats"("user_id", "is_pinned", "updated_at", "id");

-- CreateIndex
CREATE INDEX "chats_user_id_created_at_id_idx" ON "chats"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "chats_title_tsv_idx" ON "chats" USING GIN ("title_tsv");

-- CreateIndex
CREATE INDEX "chats_title_trgm_idx" ON "chats" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "chats_id_user_id_key" ON "chats"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_accounts_user_id_key" ON "credit_accounts"("user_id");

-- CreateIndex
CREATE INDEX "messages_chat_id_created_at_id_idx" ON "messages"("chat_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "messages_text_tsv_idx" ON "messages" USING GIN ("text_tsv");

-- CreateIndex
CREATE UNIQUE INDEX "messages_chat_id_client_message_id_key" ON "messages"("chat_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_dispatch_key_key" ON "agent_runs"("dispatch_key");

-- CreateIndex
CREATE INDEX "agent_runs_status_created_at_idx" ON "agent_runs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_one_active_per_chat" ON "agent_runs"("chat_id") WHERE (status IN ('queued', 'thinking', 'working', 'waiting', 'stopping'));

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_idempotency_key_key" ON "credit_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "credit_ledger_user_id_created_at_id_idx" ON "credit_ledger"("user_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_user_id_fkey" FOREIGN KEY ("chat_id", "user_id") REFERENCES "chats"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_chat_id_user_id_fkey" FOREIGN KEY ("chat_id", "user_id") REFERENCES "chats"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_message_id_fkey" FOREIGN KEY ("user_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_assistant_message_id_fkey" FOREIGN KEY ("assistant_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
