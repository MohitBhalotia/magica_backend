// Generates docs/openapi.json (OpenAPI 3.1) from the contracts' Zod schemas: the same schemas the
// API validates with, so the docs can't drift. `node scripts/openapi.ts --check` fails if the
// committed file is stale (CI). Run with Node 24+ (it runs TypeScript directly).
import { readFileSync, writeFileSync } from "node:fs";

import { z } from "zod";

import * as c from "../packages/contracts/src/index.ts";

const OUT = new URL("../docs/openapi.json", import.meta.url);

/** A schema as JSON Schema; `io: "input"` for request bodies (defaults may be left out). */
function json(schema: z.ZodType, io: "input" | "output" = "output") {
  // OpenAPI 3.1 schemas are JSON Schema 2020-12, minus the `$schema` marker.
  const schemaJson: Record<string, unknown> = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
  });
  delete schemaJson.$schema;
  return schemaJson;
}
const body = (schema: z.ZodType) => ({
  required: true,
  content: { "application/json": { schema: json(schema, "input") } },
});
const ok = (description: string, schema?: z.ZodType) => ({
  description,
  ...(schema && { content: { "application/json": { schema: json(schema) } } }),
});
const errors = {
  default: ok(
    "Error envelope; `code` is one of the closed set (see Errors).",
    c.ErrorEnvelopeSchema,
  ),
};
const pathParam = (name: string, description: string) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" },
  description,
});
const cursor = {
  name: "cursor",
  in: "query",
  schema: { type: "string" },
  description: "`nextCursor` from the previous page.",
};
const page = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
  cursor,
];
const idempotencyKey = {
  name: "Idempotency-Key",
  in: "header",
  schema: { type: "string", format: "uuid" },
  description:
    "Send the same UUID again to get the same message and run back instead of a second one.",
};

type Op = {
  summary: string;
  description?: string;
  tag: string;
  parameters?: object[];
  requestBody?: object;
  responses: Record<string, object>;
  /** Key management needs the signed-in app session; everything else also takes an API key. */
  sessionOnly?: boolean;
};

const ops: Record<string, Record<string, Op>> = {
  "/chats": {
    get: {
      tag: "Chats",
      summary: "List chats",
      description: "Pinned first, then most recent.",
      parameters: page,
      responses: { 200: ok("A page of chats.", c.ChatListSchema) },
    },
    post: {
      tag: "Chats",
      summary: "Start a chat",
      description: "Creates the chat with its first message and starts the agent's reply (a run).",
      parameters: [idempotencyKey],
      requestBody: body(c.SendMessageRequestSchema.partial({ clientMessageId: true })),
      responses: { 201: ok("The chat, its messages and the run answering.", c.SendResponseSchema) },
    },
  },
  "/chats/{chatId}": {
    get: {
      tag: "Chats",
      summary: "Get a chat",
      description:
        "The chat with its newest messages (newest first) and its active run, if any. Pass `cursor` for older messages.",
      parameters: [pathParam("chatId", "The chat's id."), cursor],
      responses: { 200: ok("The chat.", c.ChatDetailSchema) },
    },
    delete: {
      tag: "Chats",
      summary: "Delete a chat",
      parameters: [pathParam("chatId", "The chat's id.")],
      responses: { 204: ok("Deleted.") },
    },
  },
  "/chats/{chatId}/messages": {
    post: {
      tag: "Chats",
      summary: "Send a message",
      description: "A follow-up in the chat. 409 `RUN_ACTIVE` while a reply is still running.",
      parameters: [pathParam("chatId", "The chat's id."), idempotencyKey],
      requestBody: body(c.SendMessageRequestSchema.partial({ clientMessageId: true })),
      responses: { 201: ok("The new message and the run answering it.", c.SendResponseSchema) },
    },
  },
  "/chat/completions": {
    post: {
      tag: "Completions",
      summary: "Create a chat completion",
      description:
        "OpenAI-compatible. The last `user` message is the turn; pass `chat_id` to continue a chat. With `stream: true` the answer arrives as server-sent `chat.completion.chunk` events ending in `[DONE]`; tool steps ride in `magica`. Without it the call waits up to 60s, then answers 202 with the run to poll.",
      parameters: [idempotencyKey],
      requestBody: body(c.ChatCompletionRequestSchema),
      responses: {
        200: {
          description: "The answer (`stream: false`), or an SSE stream of chunks (`stream: true`).",
          content: {
            "application/json": { schema: json(c.ChatCompletionSchema) },
            "text/event-stream": { schema: json(c.ChatCompletionChunkSchema) },
          },
        },
        202: ok(
          "Still running (a long generation or an approval): poll the run.",
          c.SendResponseSchema,
        ),
      },
    },
  },
  "/tools/{tool}/run": {
    post: {
      tag: "Tools",
      summary: "Run a Magica tool",
      description:
        "Runs `crop_image`, `gpt_image_2` or `merge_videos` directly, with the same validation, credits and approvals as in chat. The input is the tool's own (see Running tools). Answers 202: poll the run or use webhooks.",
      parameters: [
        {
          name: "tool",
          in: "path",
          required: true,
          schema: { type: "string", enum: [...c.RUNNABLE_TOOLS] },
        },
        idempotencyKey,
      ],
      requestBody: body(c.ToolRunRequestSchema),
      responses: { 202: ok("The run.", c.SendResponseSchema) },
    },
  },
  "/runs/{runId}": {
    get: {
      tag: "Runs",
      summary: "Get a run",
      description: "Its status, and the question it waits on (`waitpoint`) when `waiting`.",
      parameters: [pathParam("runId", "The run's id.")],
      responses: { 200: ok("The run.", c.RunHandleSchema) },
    },
  },
  "/runs/{runId}/cancel": {
    post: {
      tag: "Runs",
      summary: "Stop a run",
      description: "Idempotent; the partial answer is kept.",
      parameters: [pathParam("runId", "The run's id.")],
      responses: { 200: ok("The run, now stopping or ended.", c.RunHandleSchema) },
    },
  },
  "/runs/{runId}/retry": {
    post: {
      tag: "Runs",
      summary: "Retry a run",
      description: "The chat's latest failed or stopped reply only.",
      parameters: [pathParam("runId", "The run's id.")],
      responses: { 201: ok("The new run.", c.SendResponseSchema) },
    },
  },
  "/waitpoints/{waitpointId}/respond": {
    post: {
      tag: "Runs",
      summary: "Answer a waiting run",
      description:
        "Approve or decline a cost, pick an option, or approve a plan. Exactly once: a repeat returns the first answer.",
      parameters: [pathParam("waitpointId", "From the run's `waitpoint`.")],
      requestBody: body(c.RespondWaitpointRequestSchema),
      responses: { 200: ok("The answered waitpoint.", c.WaitpointSchema) },
    },
  },
  "/credits": {
    get: {
      tag: "Credits",
      summary: "Get your balance",
      responses: { 200: ok("Balance in microcredits.", c.CreditBalanceSchema) },
    },
  },
  "/webhooks": {
    get: {
      tag: "Webhooks",
      summary: "List webhook endpoints",
      parameters: page,
      responses: { 200: ok("A page of endpoints.", c.WebhookEndpointListSchema) },
    },
    post: {
      tag: "Webhooks",
      summary: "Register a webhook endpoint",
      description: "A public HTTPS URL. The signing secret is in this response only.",
      requestBody: body(c.CreateWebhookRequestSchema),
      responses: { 201: ok("The endpoint and its secret.", c.CreateWebhookResponseSchema) },
    },
  },
  "/webhooks/{webhookId}": {
    delete: {
      tag: "Webhooks",
      summary: "Delete a webhook endpoint",
      parameters: [pathParam("webhookId", "The endpoint's id.")],
      responses: { 204: ok("Deleted.") },
    },
  },
  "/webhooks/{webhookId}/test": {
    post: {
      tag: "Webhooks",
      summary: "Send a test ping",
      parameters: [pathParam("webhookId", "The endpoint's id.")],
      responses: { 202: ok("The ping event, queued.", c.WebhookEventSchema) },
    },
  },
  "/api-keys": {
    get: {
      tag: "API keys",
      summary: "List API keys",
      sessionOnly: true,
      parameters: page,
      responses: { 200: ok("A page of keys (never the keys themselves).", c.ApiKeyListSchema) },
    },
    post: {
      tag: "API keys",
      summary: "Create an API key",
      sessionOnly: true,
      requestBody: body(c.CreateApiKeyRequestSchema),
      responses: { 201: ok("The key, shown once.", c.CreateApiKeyResponseSchema) },
    },
  },
  "/api-keys/{keyId}": {
    delete: {
      tag: "API keys",
      summary: "Revoke an API key",
      sessionOnly: true,
      parameters: [pathParam("keyId", "The key's id.")],
      responses: { 204: ok("Revoked.") },
    },
  },
};

const webhookDocs: Record<string, string> = {
  "agent.started": "A run began working on a reply.",
  "agent.completed": "A reply finished. `creditsUsedMicro` is what its tools cost.",
  "agent.failed":
    "A reply failed or was stopped (`status` is `failed` or `cancelled`), with a user-safe `error`.",
  "tool.completed": "A Magica tool call succeeded, with its credits.",
};

const document = {
  openapi: "3.1.0",
  info: {
    title: "Magica Agent API",
    version: "1.0.0",
    description:
      "Talk to the Magica agent, run its media tools and follow runs. All amounts are microcredits.",
  },
  servers: [{ url: "https://magica-galaxy-backend.vercel.app/api/v1" }],
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        description: "`Authorization: Bearer ak_…` (API keys, from the app's user menu).",
      },
      session: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "The signed-in app session (Clerk).",
      },
    },
  },
  paths: Object.fromEntries(
    Object.entries(ops).map(([path, methods]) => [
      path,
      Object.fromEntries(
        Object.entries(methods).map(([method, { tag, sessionOnly, responses, ...op }]) => [
          method,
          {
            ...op,
            tags: [tag],
            operationId: `${method}${path
              .replace(/[{}]/g, "")
              .replace(/\/(\w)/g, (_, ch: string) => ch.toUpperCase())
              .replace(/[^A-Za-z]/g, "")}`,
            ...(sessionOnly && { security: [{ session: [] }] }),
            responses: { ...responses, ...errors },
          },
        ]),
      ),
    ]),
  ),
  webhooks: Object.fromEntries(
    Object.entries(webhookDocs).map(([type, description]) => [
      type,
      {
        post: {
          summary: type,
          description: `${description} Signed with the Standard Webhooks headers; see Webhooks.`,
          requestBody: body(c.WebhookEventSchema),
          responses: {
            200: { description: "Any 2xx: delivered. Anything else is retried with backoff." },
          },
        },
      },
    ]),
  ),
};

const text = `${JSON.stringify(document, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== text) {
    process.stderr.write("docs/openapi.json is stale: run `pnpm openapi`.\n");
    process.exit(1);
  }
} else writeFileSync(OUT, text);
