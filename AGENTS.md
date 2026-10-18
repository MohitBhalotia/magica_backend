# AGENTS.md — magica_backend (backend)

This repo is the backend of the Agent Chat clone. It contains:
- REST route handlers (Next.js App Router)
- Prisma/PostgreSQL
- Trigger.dev tasks
- the tool, skill and waitpoint registries
- the `@mohitbhalotia/magica-contracts` package
- Mintlify API docs

The frontend lives in the separate `magica_frontend` repo.

In the planning workspace, read `../MEMORY.md` first (project context) and update it on important instructions or decisions.
**Read [`RULES.md`](RULES.md) before writing any code.** It holds the coding conventions, naming, errors and testing rules.
**Read [`ARCHITECTURE.md`](ARCHITECTURE.md) before any work on runs, tasks, the DB, credits or realtime.** It holds the decision log; don't contradict an Accepted decision without asking.
If this repo sits inside the planning workspace, also read `../AGENTS.md` and `../PRD.md`. The PRD section numbers below refer to that file.

## Commands
| Task | Command |
|---|---|
| Install | `pnpm install` |
| Dev API | `pnpm dev` |
| Trigger.dev dev worker | `pnpm trigger:dev` |
| Typecheck / lint / test | `pnpm typecheck` · `pnpm lint` · `pnpm test` |
| Integration tests (Docker needed) | `pnpm test:int` |
| Live provider tests (spends credits — ask first) | `pnpm test:live` |
| Prisma migrate (dev) / generate | `pnpm db:migrate` · `pnpm db:generate` |
| Build + publish contracts | `pnpm contracts:build` · `pnpm contracts:publish` |
| Generate OpenAPI → docs | `pnpm openapi` |
| Docs preview | `pnpm docs:dev` |

Required before every commit: `pnpm typecheck && pnpm lint && pnpm test`.
(M0 creates these scripts with exactly these names. Keep them in sync if they change.)

## Layout
```
packages/contracts/    Zod source of truth: api, messages, content blocks, tools, realtime metadata, webhooks, errors
agent-skills/<name>/   SKILL.md (YAML name+description) + optional guides/assets
prisma/                schema.prisma, migrations/ (each migration.sql opens with forward/rollback/compat notes)
src/app/api/v1/        route.ts files: wiring only (re-export controller handlers)
src/app/api/webhooks/  route.ts wiring → modules/webhooks/*.controller.ts (signature-verified, deduped)
src/modules/<feature>/ <x>.controller.ts · <x>.service.ts · <x>.repository.ts · <x>.mapper.ts · __tests__/
                       features: chats, messages, runs, credits, uploads, assets, waitpoints, webhooks, api-keys, users
src/agent/             loop, prompt assembly, context window + summary
src/tools/             registry.ts + one *.tool.ts per tool
src/skills/            registry, loader, path security
src/waitpoints/        registry + types
src/providers/         openRouter.provider.ts, magica.client.ts, transloadit.client.ts, r2.client.ts
src/realtime/          bounded metadata + stream writers
src/trigger/           agentTurn.task.ts, magicaRun.task.ts, crons (sweeper, redispatch, waitpoint expiry, purge)
src/lib/               db.ts (Prisma singleton), errors.ts (AppError), withHandler.ts, logger.ts, auth.ts, env.ts, pagination.ts, rateLimiter.ts
docs/                  Mintlify
```

## Rules (repo-specific)
- **Layers (RULES.md §10.1):** `route.ts → controller → service → repository → Prisma`, one way only.
  - Controllers handle HTTP only. Services hold business logic and own transactions. Repositories hold Prisma access only, and take an optional `tx` client plus `userId` for ownership.
  - Tasks, webhooks and the agent loop enter at the service layer. Never import a repository outside its own module's service.
- **Contracts first.**
  - Any new or changed request, response, block, tool, metadata or webhook shape starts in `packages/contracts`.
  - Types are inferred with `z.infer`; never hand-written duplicates.
  - Bump the version with semver and publish before the frontend consumes it.
- **Tools** are declared with `defineTool({ name, kind, description, input, output, estimateCredits, requiresApproval?, execute, sanitize? })`.
  - Tools return data. They never touch `Message`/`AgentRun` rows; the orchestrator persists.
  - Adding a tool means adding one file plus registry registration. No orchestrator edits.
- **Magica:**
  - Base URL comes from `MAGICA_BASE_URL`. Never hard-code a host.
  - Persist `magicaRunId` before waiting; if one exists, reconcile instead of re-POSTing.
  - Webhook-first with a fallback poll; respect the key limit of 60 requests/min.
  - Validate `output` with Zod and copy results to R2.
  - Map errors per PRD §5.6. Note that 403 means insufficient credits.
  - Default GPT Image 2 `quality` to `Low` unless the user asks otherwise.
- **OpenRouter:**
  - Only `openrouter/free`. Record the routed `response.model`.
  - Handle 429/503 (`Retry-After`, durable backoff ≤ 3), empty streams, malformed tool calls (repair ≤ 2), max turns, and abort.
- **Skills:**
  - The base prompt carries names and descriptions only; bodies load via `load_skill` / `read_skill_asset`.
  - Normalize paths plus a containment check, an extension allowlist and size caps.
  - Persist a `RunSkill` row with a content hash and replay the stored snapshot on retry.
  - Skill text never grants permissions.
- **Trigger.dev:**
  - Dispatch with `idempotencyKey`, using `runId` for turns and `invocationId` for Magica child runs.
  - Use `concurrencyKey: userId`.
  - Wait with `wait.forToken` / `wait.for`.
  - Check cancellation before each step.
  - Tasks must be safe to retry from any point.
- **Prisma:**
  - Use transactions for message + run + reserve creation and for settlement.
  - Write partial unique indexes and GIN/tsvector as raw SQL inside migrations.
  - Money is `BigInt` microcredits.
  - Every list query uses a cursor and is capped at `limit ≤ 50`.
- **Webhooks in:** verify the signature, dedupe via `ProviderWebhookEvent`, respond 200 fast, and do the work in a task.
- **Webhooks out:** Standard Webhooks signing, delivered by a Trigger.dev task with retries; unique on `(endpointId, eventId)`.
- **Rate limiting:**
  - Always go through the `RateLimiter` interface, backed by Upstash Redis via `@upstash/ratelimit`. Never call Redis directly.
  - Redis is for counters only.
  - When Redis is unavailable: fail open for user limits; fail closed with backoff for the provider buckets (OpenRouter, Magica).
- **Logging:** pino with `chatId, runId, messageId, traceId, processId, waitpointTokenId`. Never log secrets, full prompts with keys, or raw provider payloads with credentials.

## Hard rules (summary — full list in workspace `AGENTS.md`)
- OpenRouter Free with no paid fallback.
- The three Magica tools must be real; never stubbed outside tests.
- PostgreSQL only.
- The fixed stack.
- Secrets server-side only.
- Ownership checks on every query, returning 404.
- Idempotency keys on every side effect.
- No paid services without asking.

## Git
- Feature branches, Conventional Commits (`feat(tools): …`, `fix(magica): …`, `test(skills): …`).
- Commit only after the checks pass. Push and open PRs only when the user asks.
- Never edit an applied migration.
