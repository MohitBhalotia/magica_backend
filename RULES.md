# RULES.md — Coding Rules & Conventions

> **This file is identical in `magica_backend` and `magica_frontend`.** Edit both copies in the same change.
> Product and architecture rules live in `PRD.md`, `ARCHITECTURE.md` (backend) and `DESIGN.md` (frontend); this file covers *how we write code*.
> Tags: **[Brief]** required by the assignment · **[Decision]** our convention (changeable by agreement). The reasons behind the decisions are in `DECISIONS.md` (workspace root).

---

## 1. Principles
1. **Least code for the behaviour.** The brief rewards "least lines of code for the same functionality". Delete before adding; no speculative abstractions, no dead code, no commented-out code. [Brief]
2. **Contracts at every boundary.** If data crosses a trust boundary it is parsed with Zod — request, response, tool I/O, realtime metadata, webhooks, env, persisted JSONB. [Brief]
3. **Registries over branches.** New tools, skills, waitpoint types, block/tool/asset renderers are *registered*, never `switch`-ed into orchestration or UI. [Brief]
4. **Make illegal states unrepresentable.** Discriminated unions + exhaustive checks over boolean flags and optional soup.
5. **Explicit over clever.** Readable, boring code wins; comment the *why*.

---

## 2. TypeScript
- `tsconfig` [Decision]: `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `moduleResolution: "bundler"`, path alias `@/* → src/*`.
- Banned: `any`, `@ts-ignore`, `@ts-nocheck`, `as unknown as T`. `@ts-expect-error` only with a reason comment. Non-null `!` only with a one-line justification.
- Prefer `type` for shapes, `interface` only when declaration-merging is needed. Types derived from Zod: `type X = z.infer<typeof XSchema>` — never hand-written duplicates.
- Narrow `unknown` with Zod or type guards; never cast external data.
- Exhaustiveness: every `switch` over a union ends with `default: assertNever(x)`.
- `const` by default; no `let` unless reassigned; no `var`. No enums — use `as const` objects or Zod enums.
- Money / credits are `bigint` microcredits end-to-end; serialise as strings in JSON. Never `number` for money. [Decision]
- Dates: store/transmit ISO-8601 UTC strings; format only in UI.

---

## 3. Naming
| Thing | Convention | Example |
|---|---|---|
| React component files | **PascalCase** `.tsx` | `StepRow.tsx`, `Composer.tsx` |
| Other TS files | **camelCase** with role suffix where useful [Decision] | `chat.controller.ts`, `chat.service.ts`, `creditLedger.repository.ts`, `chat.mapper.ts`, `cropImage.tool.ts`, `agentTurn.task.ts`, `useRunStream.ts`, `chat.schema.ts` |
| Folders | **kebab-case** [Decision] | `step-group/`, `agent-skills/`, `files-modal/` |
| Next.js reserved files | as Next requires | `page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx` |
| Components, types, Zod schemas | PascalCase; schemas suffixed `Schema` | `StepRow`, `RunStatus`, `RunStatusSchema` |
| Functions, variables | camelCase, verbs for functions | `reserveCredits`, `isTerminal` |
| Constants (module-level, true constants) | SCREAMING_SNAKE | `MAX_ATTACHMENTS` |
| Hooks | `useX` | `useActiveRun` |
| Booleans | `is/has/can/should` prefix | `isPinned`, `hasMore` |
| Error codes | SCREAMING_SNAKE in contracts | `RUN_ACTIVE`, `INSUFFICIENT_CREDITS` |
| Trigger.dev task ids, tool names, skill names | kebab-case / snake_case as the external contract requires | task `agent-turn`, tool `crop_image`, skill `crop-image` |
| DB (Prisma) | Models PascalCase singular; fields camelCase; `@@map` to snake_case tables/columns | `model AgentRun` → `agent_runs` |
| Env vars | SCREAMING_SNAKE; client-exposed only with `NEXT_PUBLIC_` | `MAGICA_BASE_URL` |

No abbreviations except well-known ones (`id`, `url`, `db`, `llm`, `ui`). No `utils.ts` / `helpers.ts` grab-bags — name modules by what they do.

---

## 4. Modules, imports & exports
- **Named exports only.** Default exports only where Next.js requires them (`page`, `layout`, `route` handlers are named `GET/POST`, `default` for pages/layouts).
- No barrel files (`index.ts` re-exporting a folder) except the published `@agent-chat/contracts` entry — barrels hurt tree-shaking and create cycles.
- Import order (enforced by ESLint): node built-ins → external packages → `@agent-chat/contracts` → `@/` aliases → relative. Use `import type` for type-only imports.
- No circular imports (enforced). No deep relative paths beyond `../..` — use `@/`.
- One component per file (small private sub-components in the same file are fine if < ~30 lines).

---

## 5. Validation & contracts
- All shared shapes live in `packages/contracts` (backend repo) and are consumed via `@agent-chat/contracts`. The frontend **never** redefines them. [Brief]
- Parse at the edge with `.parse` / `safeParse`, then trust the typed value inside. Don't re-validate the same data deeper in.
- Env vars are validated once at boot (`env.ts` with Zod); import `env`, never `process.env` elsewhere.
- JSONB columns are written only after Zod validation and read back through the same schema.
- Contract changes: semver bump, changelog line, publish, then update the consumer (separate PR). Breaking = major.

---

## 6. Errors [Decision: typed `AppError` throws]
```ts
// contracts: ErrorCodeSchema = z.enum(["VALIDATION_FAILED","NOT_FOUND","RUN_ACTIVE","INSUFFICIENT_CREDITS",…])
throw new AppError("RUN_ACTIVE", "A response is already in progress for this chat.", { activeRunId });
```
- Expected failures **throw `AppError(code, safeMessage, details?, { cause, retryable })`**. Codes come only from the contracts enum; `message` is user-safe.
- One mapper per edge turns errors into the envelope `{ error: { code, message, details?, traceId } }` plus an HTTP status (`errorStatus[code]`): `withHandler()` for controllers, including webhook controllers, and task `onFailure`. Nowhere else formats errors.
- Unknown errors → logged with stack + context, surfaced as `INTERNAL` with `traceId`. Never leak stack traces, provider bodies, SQL, or secrets to clients or the LLM.
- Wrap provider errors at the adapter boundary (OpenRouter, Magica, Transloadit) into `AppError` with `cause`; callers never see raw `fetch`/SDK errors.
- Don't catch to ignore. A `catch` must handle, translate, or rethrow — and if it intentionally swallows (e.g. best-effort cleanup), comment why and log.
- Unauthorized resource access → `NOT_FOUND` (never reveal existence). [Brief]

---

## 7. Async, concurrency & idempotency
- Every side effect has an idempotency key enforced by a DB unique constraint or Trigger.dev `idempotencyKey` (see ARCHITECTURE.md §6.3). No exceptions. [Brief]
- Use transactions for multi-row writes that must agree (message + run + reserve; settlement). Keep transactions short — no network calls inside.
- Pass `AbortSignal` through every cancellable path (LLM stream, provider fetch, tool execute). Check cancellation before each step.
- No floating promises (lint-enforced). Parallel work via `Promise.all` / `allSettled` with deterministic ordering of results.
- Retries only for errors marked `retryable`, with bounded exponential backoff + jitter; respect `Retry-After`. Inside Trigger.dev tasks use `wait.*` for delays, never `setTimeout` loops.
- Provider and user rate limits go through the `RateLimiter` interface (Upstash). Redis holds counters only — never durable state.

---

## 8. Logging & observability
- Use the shared `logger` (pino). No `console.*` in committed code (lint-enforced; allowed in scripts).
- Structured fields, not string interpolation: `logger.info({ chatId, runId }, "run dispatched")`.
- Always attach available context: `chatId, runId, messageId, traceId, processId, waitpointTokenId`. Create child loggers per request/task.
- Levels: `error` (needs action), `warn` (degraded/retried), `info` (lifecycle), `debug` (dev only). Never log secrets, tokens, full prompts with user data, or raw provider payloads.

---

## 9. Security
- Secrets (Magica, OpenRouter, Transloadit, R2, Upstash, webhook secrets) are server-only. Never in client bundles, prompts, logs, persisted messages, or error details. [Brief]
- Every DB query on user data includes ownership (`where: { id, userId }`). [Brief]
- Verify signatures on every inbound webhook (Clerk/Svix, Magica/Svix, Transloadit) and dedupe by delivery id.
- Sanitize tool inputs/outputs before persisting or rendering (`tool.sanitize`). Render user/LLM Markdown with a sanitizing renderer — no raw `dangerouslySetInnerHTML`.
- Skill loader: normalize + contain paths, extension allowlist, size caps. Skill text never grants permissions.

---

## 10. Backend conventions (`magica_backend`)

### 10.1 Layered feature modules [Decision]
ORM: **Prisma** (PostgreSQL) [Brief]. Every feature lives in `src/modules/<feature>/` with **one file per responsibility**:
```
src/
  app/api/v1/chats/[chatId]/messages/route.ts  # wiring only: export { sendMessage as POST } from "@/modules/messages/message.controller"
  modules/
    chats/      chat.controller.ts  chat.service.ts  chat.repository.ts  chat.mapper.ts  __tests__/
    messages/   message.controller.ts  message.service.ts  message.repository.ts
    runs/       run.controller.ts  run.service.ts  run.repository.ts  toolInvocation.repository.ts  runSkill.repository.ts
    credits/    credit.controller.ts  credit.service.ts  creditLedger.repository.ts
    uploads/  waitpoints/  assets/  webhooks/  api-keys/  users/
  agent/  tools/  skills/  providers/    # agent loop, registries, OpenRouter/Magica/Transloadit adapters
  trigger/                               # *.task.ts — call services
  lib/                                   # db.ts (prisma), errors.ts, logger.ts, auth.ts, env.ts, pagination.ts, rateLimiter.ts
```

**Dependency direction (one way only):** `route.ts → controller → service → repository → Prisma`.
Trigger tasks, webhook controllers, and the agent loop also enter at the **service** layer.

| Layer | Owns | Must not |
|---|---|---|
| `route.ts` | Re-export controller handlers (Next.js requires the file) | Any logic |
| `*.controller.ts` | HTTP only: resolve auth context, parse params/query/body/headers with contracts, call **one** service method, map result → contract DTO + status. All handlers wrapped in `withHandler()` (auth, traceId, logger, `AppError` → envelope) | Prisma, business rules, transactions, calling repositories |
| `*.service.ts` | Business logic & orchestration: rules, ownership decisions, transactions, idempotency, credits, dispatching tasks, calling providers & other services. Input: typed args + `ctx { userId, traceId, logger }` | `Request`/`Response`/`NextResponse` or any HTTP type; formatting HTTP errors; raw Prisma calls |
| `*.repository.ts` | **Only** Prisma access for one aggregate (`Chat`, `AgentRun`, `CreditLedger` …). Typed methods (`findOwned`, `listByUserCursor`, `createQueued`, `markTerminal`) | Business rules, calling services/other repositories, throwing HTTP errors |
| `*.mapper.ts` (optional) | Prisma row → contract DTO when shapes differ | Logic beyond mapping |

**Repository rules**
- Every method accepts an optional DB client as its **last** param: `db: DbClient = prisma` where `type DbClient = PrismaClient | Prisma.TransactionClient`.
- Ownership is part of the method signature for user data: `findOwned(chatId, userId, db?)` → `null` if not owned (service throws `NOT_FOUND`). There is no un-scoped "findById" for user data.
- Lists use cursor pagination only via `lib/pagination.ts` (`limit ≤ 50`, keyset on the composite index). No `OFFSET`, no unbounded `findMany`; `select` only the columns needed.
- Unique-constraint violations (`P2002`) are translated into typed results (`{ created: false, existing }`) or `AppError` codes **in the repository**, so services never inspect Prisma error codes.
- Raw SQL (`$queryRaw`) only for full-text search, `FOR UPDATE SKIP LOCKED`, or partial-index-dependent upserts, always parameterised and kept inside the repository.

**Transactions [Decision: the service owns the TX]**
```ts
// message.service.ts
return prisma.$transaction(async (tx) => {
  const message = await messageRepository.createUser(input, tx);
  const run = await runRepository.createQueued({ chatId, messageId: message.id }, tx); // partial-unique → RUN_ACTIVE
  await creditService.reserveAdmission({ userId, runId: run.id }, tx);                 // cross-module via service
  return { message, run };
});
```
- Only services start transactions. Keep them short, with no network calls inside; dispatch to Trigger.dev **after** commit.
- Within its module a service may use its own repositories directly. **Cross-module work goes through the other module's service**, whose write methods accept an optional `tx` so they can join the caller's transaction.
- Services are plain objects of functions (`export const chatService = { … }`) importing repositories directly. No DI container or classes. Test seams come from Testcontainers and MSW, not mocks [Decision].

### 10.2 Other backend rules
- **Prisma migrations**: never edit an applied migration; raw SQL (partial unique, GIN, tsvector) goes inside migrations; each migration folder has a `README.md` with forward/rollback/compat notes. One `PrismaClient` singleton in `lib/db.ts`.
- **Trigger.dev tasks** (`*.task.ts`): thin. They call services; never repositories or Prisma directly. Must be safe to retry from any point; declare `queue`, `concurrencyKey`, `maxDuration`, `retry` explicitly.
- **Tools** (`*.tool.ts`): one file per tool via `defineTool({...})`; pure with respect to chat state (return data, never write messages or runs; read through services or providers, never repositories). Input/output Zod schemas, `estimateCredits`, optional `requiresApproval`, `sanitize`.
- **Skills**: `agent-skills/<kebab-name>/SKILL.md` with YAML `name` + `description`; bodies are guidance only.
- **Providers**: one adapter per external API (`openRouter.provider.ts`, `magica.client.ts`) behind an interface; base URLs from env.

---

## 11. Frontend conventions (`magica_frontend`)
- **Components**: function components, PascalCase files, props typed as `type XProps = {...}`. Server Components by default; add `"use client"` only where interactivity/hooks are needed, as low in the tree as possible.
- **Data**: components never call `fetch`. `src/services/*` (typed, Zod-parsed) → `src/queries/*` (TanStack Query hooks + centralised `queryKeys`). Mutations do optimistic update + rollback.
- **State**: server state in TanStack Query only; UI/live-run state in Zustand. Select narrowly (`useStore(s => s.x)`), use `useShallow` for objects; never subscribe a list to a whole store.
- **Styling**: Tailwind with design tokens only (DESIGN.md §2) — no arbitrary hex/px values, no inline `style` except computed dimensions. Compose classes with `cn()`. shadcn primitives in `components/ui/` are restyled, not forked into variants per use.
- **Renderers**: register in `blockRenderers` / `toolRenderers` / `waitpointRenderers` / `assetRenderers`; no type `switch` in thread components.
- **Performance**: virtualised message list; memoise block renderers; only the streaming block re-renders; batch stream deltas per animation frame; stable callbacks for list items.
- **Accessibility**: every icon button has an `aria-label` (copy from DESIGN.md §5.4); keyboard reachable; focus trap/return in dialogs; respect `prefers-reduced-motion`. `eslint-plugin-jsx-a11y` must pass.
- **Copy**: user-visible strings match the reference exactly; keep them in the component (no i18n layer) unless reused.

---

## 12. Testing
> What to test, the required scenario matrix, coverage gates, the CI pipeline and fidelity checks are in **`TESTING.md`** (workspace root). The README summarises them for the repo. This section covers conventions only.

- Backend layers: repositories and services get **integration tests** against a real Postgres (Testcontainers). Controllers get HTTP-level tests (request in, envelope and status out). Pure logic is extracted into functions with unit tests.
- Layout [Decision]: tests in `__tests__/` folders next to the code they cover.
  - Unit: `__tests__/creditLedger.test.ts`
  - Integration (Testcontainers Postgres + MSW): `__tests__/creditLedger.int.test.ts`
  - Component (RTL): `__tests__/StepRow.test.tsx`
  - E2E (Playwright): top-level `e2e/` (`e2e/sendTurn.spec.ts`); live-provider specs tagged `@live`.
- Name tests by behaviour: `it("returns 409 RUN_ACTIVE when the chat already has an active run")`.
- Test through public interfaces; mock only at network boundaries (MSW) — never mock Prisma or our own modules in integration tests.
- Every bug fix adds a regression test. Every idempotency key has a duplicate-execution test. [Brief: duplicate dispatch, 401/429/timeout, reconnect, persistence]
- RTL: query by role/label, not test ids or classes. No snapshot tests except the OpenAPI contract snapshot.
- Deterministic: no real timers/network in unit tests (`vi.useFakeTimers`, MSW). Live tests (`@live`) never run in CI by default.
- Gate before every commit: `pnpm typecheck && pnpm lint && pnpm test`.

---

## 13. Comments & documentation
- Comment *why* (constraints, trade-offs, links to ARCHITECTURE decisions), not *what*. TSDoc on exported functions of contracts, registries, and providers.
- `TODO(name): …` must reference an issue or milestone; none in `main` without one.
- Update `ARCHITECTURE.md` / `DESIGN.md` / this file in the same PR when a change affects them.

---

## 14. Tooling [Decision]
- **ESLint** (flat config): `eslint-config-next`, `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, `eslint-plugin-import-x` (order, no-cycle, no-default-export with Next.js overrides), `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y` (frontend), `no-console`, `@typescript-eslint/no-floating-promises`, `switch-exhaustiveness-check`.
- **Prettier**: `printWidth: 100`, double quotes, semicolons, `trailingComma: "all"`; `prettier-plugin-tailwindcss` (frontend). ESLint never formats (`eslint-config-prettier`).
- **Husky + lint-staged**: pre-commit runs `eslint --fix` + `prettier --write` on staged files; `pnpm typecheck && pnpm test` required before commit (agents run it explicitly).
- **commitlint** with Conventional Commits.
- Node LTS pinned via `.nvmrc` and `engines`; pnpm version pinned via `packageManager`.

---

## 15. Git & PRs
- Branches: `feat/<scope>-<desc>`, `fix/…`, `chore/…`, `test/…`, `docs/…`. Never commit to `main`.
- Conventional Commits with scope: `feat(tools): add merge_videos`, `fix(realtime): refresh token before expiry`. Small, single-purpose commits — the brief grades history. [Brief]
- PRs: one milestone task each; description = what/why, screenshots for UI (with the reference side-by-side), test evidence, linked decision IDs.
- Agents commit only after the gate passes; push/PR only when the user asks.

---

## 16. Dependencies
- Stack is fixed by the brief (see AGENTS.md); the only approved addition is Upstash Redis for rate-limit counters. Anything else needs agreement first.
- Prefer the platform and existing deps over new packages; justify each new dep in the PR (size, maintenance, why not existing). Pin exact versions; commit `pnpm-lock.yaml`.
- Use Context7 to check current library docs before writing integration code.
