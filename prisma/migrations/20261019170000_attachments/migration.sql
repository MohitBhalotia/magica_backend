-- M5 uploads (PRD §5.10): files a user uploads through Uppy → Transloadit → private R2, attached on send.
-- Forward: pnpm db:deploy. Additive only: two new enums and one new table; no existing rows change.
-- Rollback: DROP TABLE "attachments"; DROP TYPE "attachment_status", "attachment_kind";
--           then delete this migration's row from _prisma_migrations.
-- Compat: code from before M5 never reads or writes this table.
-- CreateEnum
CREATE TYPE "attachment_kind" AS ENUM ('image', 'video', 'audio');

-- CreateEnum
CREATE TYPE "attachment_status" AS ENUM ('uploading', 'ready', 'failed');

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_file_id" TEXT NOT NULL,
    "message_id" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "kind" "attachment_kind" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "status" "attachment_status" NOT NULL DEFAULT 'uploading',
    "assembly_id" TEXT,
    "r2_key" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_user_id_created_at_id_idx" ON "attachments"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "attachments_assembly_id_idx" ON "attachments"("assembly_id");

-- CreateIndex
CREATE INDEX "attachments_message_id_idx" ON "attachments"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_user_id_client_file_id_key" ON "attachments"("user_id", "client_file_id");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
