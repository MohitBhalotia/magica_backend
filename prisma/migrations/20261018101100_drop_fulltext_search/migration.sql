-- Drop full-text search (DEC-049): search is a case-insensitive substring match (ILIKE) instead.
-- Forward: pnpm db:deploy. No data loss: both columns were GENERATED from title/text.
-- Rollback: re-add the columns as GENERATED ALWAYS AS (to_tsvector('simple', title|text)) STORED
--           with their GIN indexes (see 20261017135655_init), then delete this migration's row from _prisma_migrations.
-- Compat: chats_title_trgm_idx (pg_trgm) stays and serves title ILIKE. App code no longer reads *_tsv.
-- DropIndex
DROP INDEX "chats_title_tsv_idx";

-- DropIndex
DROP INDEX "messages_text_tsv_idx";

-- AlterTable
ALTER TABLE "chats" DROP COLUMN "title_tsv";

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "text_tsv";
