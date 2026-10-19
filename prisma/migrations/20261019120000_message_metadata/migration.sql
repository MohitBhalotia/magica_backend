-- Message metadata (DEC-052): the AI SDK UIMessage metadata of a turn, e.g. thinking time.
-- Forward: pnpm db:deploy. Additive nullable column; no backfill (old rows read as null).
-- Rollback: ALTER TABLE "messages" DROP COLUMN "metadata"; then delete this migration's row from _prisma_migrations.
-- Compat: older app code ignores the column.
-- AlterTable
ALTER TABLE "messages" ADD COLUMN "metadata" JSONB;
