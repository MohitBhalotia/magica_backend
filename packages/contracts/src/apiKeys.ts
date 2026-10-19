import { z } from "zod";

import { pageSchema } from "./pagination.ts";

/** Public API keys look like `ak_<43 base64url chars>`; the prefix tells them from session tokens. */
export const API_KEY_PREFIX = "ak_";

/** A key as listed: never the key itself (only its hash is stored), just enough to recognise it. */
export const ApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The key's first characters, e.g. `ak_3f9Q…`, to tell keys apart. */
  prefix: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const ApiKeyListSchema = pageSchema(ApiKeySchema);
export type ApiKeyList = z.infer<typeof ApiKeyListSchema>;

/** `POST /api-keys` (signed-in session only: a key can't make keys). */
export const CreateApiKeyRequestSchema = z.object({ name: z.string().trim().min(1).max(60) });
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

/** The new key, shown once: it can't be read back later. */
export const CreateApiKeyResponseSchema = z.object({ apiKey: ApiKeySchema, key: z.string() });
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponseSchema>;
