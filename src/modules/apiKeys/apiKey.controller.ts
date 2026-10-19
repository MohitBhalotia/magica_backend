import { NextResponse } from "next/server";

import {
  CreateApiKeyRequestSchema,
  PageQuerySchema,
  type ApiKeyList,
  type CreateApiKeyResponse,
} from "@mohitbhalotia/magica-contracts";

import { withSessionHandler } from "@/lib/withHandler";
import { apiKeyService } from "@/modules/apiKeys/apiKey.service";

// Key management needs the signed-in session: a leaked key can't make or list more keys.

export const listApiKeys = withSessionHandler(async (req, { userId }) => {
  const { limit, cursor } = PageQuerySchema.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  return NextResponse.json<ApiKeyList>(await apiKeyService.list(userId, limit, cursor));
});

export const createApiKey = withSessionHandler(async (req, { userId }) => {
  const { name } = CreateApiKeyRequestSchema.parse(await req.json());
  return NextResponse.json<CreateApiKeyResponse>(await apiKeyService.create(userId, name), {
    status: 201,
  });
});

export const revokeApiKey = withSessionHandler<{ keyId: string }>(
  async (_req, { userId, params }) => {
    await apiKeyService.revoke((await params).keyId, userId);
    return new NextResponse(null, { status: 204 });
  },
);
