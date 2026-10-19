-- M7 public API keys (PRD §6.8): a user's keys, stored as SHA-256 hashes; the key is shown once.
-- Forward: pnpm db:deploy. Additive only: one new table; no existing rows change.
-- Rollback: DROP TABLE "api_keys"; then delete this migration's row from _prisma_migrations.
-- Compat: code from before M7 never reads or writes this table.
-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys"("hash");

-- CreateIndex
CREATE INDEX "api_keys_user_id_created_at_id_idx" ON "api_keys"("user_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
