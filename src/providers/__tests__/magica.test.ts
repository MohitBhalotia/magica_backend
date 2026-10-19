import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { magica } from "@/providers/magica";

// MAGICA_BASE_URL and MAGICA_API_KEY are test values from vitest.config.ts; MSW answers here.
const API = "https://magica.test/v1";
const KEY = "gx_test_dummy";

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const cropSchema = {
  modelId: "crop_image",
  name: "Crop Image",
  category: "utility",
  fields: [{ name: "image_url", type: "image", required: true }],
  defaults: {},
  capabilities: {},
};

describe("searchModels", () => {
  it("sends the key and query, and returns the grouped models", async () => {
    let auth: string | null = null;
    let query: string | null = null;
    server.use(
      http.get(`${API}/models/search`, ({ request }) => {
        auth = request.headers.get("authorization");
        query = new URL(request.url).searchParams.get("query");
        return HttpResponse.json({
          modelCatalog: { utility: [{ modelId: "crop_image", name: "Crop", category: "utility" }] },
          categoryRoles: { utility: "UTILITY" },
          usage: "MCP playbook",
        });
      }),
    );

    const result = await magica.searchModels("crop image");

    expect(auth).toBe(`Bearer ${KEY}`);
    expect(query).toBe("crop image");
    expect(result.modelCatalog.utility?.[0]?.modelId).toBe("crop_image");
  });
});

describe("modelSchema", () => {
  it("passes the schema through and caches it per model", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/models/crop_image/schema`, () => {
        calls++;
        return HttpResponse.json(cropSchema);
      }),
    );
    expect(await magica.modelSchema("crop_image")).toEqual(cropSchema);
    expect(await magica.modelSchema("crop_image")).toEqual(cropSchema);
    expect(calls).toBe(1);
  });
});

describe("errors", () => {
  const failWith = (status: number, body: object = {}, headers: Record<string, string> = {}) => {
    server.use(
      http.get(`${API}/models/search`, () => HttpResponse.json(body, { status, headers })),
    );
    return magica.searchModels("x");
  };

  it.each([
    [401, "PROVIDER_AUTH"],
    [403, "PROVIDER_CREDITS"],
    [404, "MODEL_UNAVAILABLE"],
    [410, "MODEL_UNAVAILABLE"],
    [500, "PROVIDER_ERROR"],
  ])("HTTP %i → %s, without leaking the key", async (status, code) => {
    const error: unknown = await failWith(status).catch((err: unknown) => err);
    expect(error).toMatchObject({ code });
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect((error as Error).message).not.toContain(KEY);
  });

  it("a 400 keeps Magica's message so the model can fix its input", async () => {
    await expect(failWith(400, { message: "x_percent must be ≤ 100" })).rejects.toMatchObject({
      code: "INVALID_TOOL_INPUT",
      message: "x_percent must be ≤ 100",
    });
  });

  it("keeps Magica's traceId for debugging", async () => {
    await expect(failWith(500, { traceId: "tr_123" })).rejects.toMatchObject({
      details: { status: 500, magicaTraceId: "tr_123" },
    });
  });

  it("a 429 is retryable and carries Retry-After", async () => {
    await expect(failWith(429, {}, { "retry-after": "12" })).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
      details: { retryAfterSeconds: 12 },
    });
  });

  it("a network failure is a retryable provider error", async () => {
    server.use(http.get(`${API}/models/search`, () => HttpResponse.error()));
    await expect(magica.searchModels("x")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: true,
    });
  });

  it("a stopped turn aborts the request and isn't reported as a Magica failure", async () => {
    server.use(
      http.get(`${API}/models/search`, () => new Promise(() => undefined)), // never answers
    );
    const stop = new AbortController();
    const pending = magica.searchModels("x", stop.signal);
    stop.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
