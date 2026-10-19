import { createHash, randomBytes } from "node:crypto";

import { API_KEY_PREFIX, type ApiKey } from "@mohitbhalotia/magica-contracts";

import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimiter";
import { apiKeyRepository } from "@/modules/apiKeys/apiKey.repository";
import { userService } from "@/modules/users/user.service";

import type { ApiKey as ApiKeyRow } from "../../../prisma/generated/client";

/** Shown in lists so a user can tell keys apart: `ak_` plus 7 characters. */
const SHOWN_CHARS = 10;

const hashOf = (key: string) => createHash("sha256").update(key).digest("hex");

const toApiKey = (row: ApiKeyRow): ApiKey => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

const notFound = () => new AppError("NOT_FOUND", "API key not found.");

export const apiKeyService = {
  /** A new key for the user. The key itself is returned once; only its hash is kept. */
  async create(userId: string, name: string) {
    await userService.ensure(userId);
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const row = await apiKeyRepository.create({
      userId,
      name,
      prefix: key.slice(0, SHOWN_CHARS),
      hash: hashOf(key),
    });
    return { apiKey: toApiKey(row), key };
  },

  async list(userId: string, limit: number, cursor?: string) {
    const page = await apiKeyRepository.list(userId, limit, cursor);
    return { items: page.items.map(toApiKey), nextCursor: page.nextCursor };
  },

  async revoke(id: string, userId: string) {
    const { count } = await apiKeyRepository.revoke(id, userId);
    if (count === 0) throw notFound();
  },

  /** The owner of a live key, rate limited per key. Unknown and revoked keys get the same 401. */
  async authenticate(key: string): Promise<string> {
    const row = await apiKeyRepository.findActive(hashOf(key));
    if (!row) throw new AppError("UNAUTHENTICATED", "That API key isn't valid.");
    await enforceRateLimit("public", row.id);
    await apiKeyRepository.touch(row.id);
    return row.userId;
  },
};
