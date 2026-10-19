import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    // dummy values so importing env.ts doesn't fail; real keys never load in tests
    env: {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_dummy",
      CLERK_SECRET_KEY: "sk_test_dummy",
      FRONTEND_ORIGINS: "http://localhost:3000",
      DATABASE_URL: "postgresql://dummy:dummy@localhost:5432/dummy",
      UPSTASH_REDIS_URL: "https://dummy.upstash.io",
      UPSTASH_REDIS_TOKEN: "dummy",
      TRIGGER_SECRET_KEY: "tr_test_dummy",
      OPENROUTER_API_KEY: "sk-or-test-dummy",
      // Magica is mocked with MSW in tests; this host never receives a real request.
      MAGICA_API_KEY: "gx_test_dummy",
      MAGICA_BASE_URL: "https://magica.test/v1",
      LOG_LEVEL: "silent",
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["**/__tests__/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "int",
          include: ["**/__tests__/**/*.int.test.ts"],
          exclude: ["**/node_modules/**"],
          // Real Postgres on a throwaway Neon branch (see vitest.int.setup.ts).
          globalSetup: ["./vitest.int.setup.ts"],
          setupFiles: ["./vitest.int.env.ts"],
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      // shortcut: the default pre-run clean wipes unit coverage while the int project's slow
      // globalSetup (Neon branch) is still starting, reporting 0%. Revisit if Vitest fixes it.
      clean: false,
      include: ["src/**/*.ts", "packages/contracts/src/**/*.ts"],
      exclude: ["**/__tests__/**", "src/app/**"],
      // TESTING.md §6 gates
      thresholds: {
        lines: 70,
        branches: 70,
        "src/modules/**/*.{service,repository}.ts": { lines: 85, branches: 85 },
        "src/{agent,tools,skills,waitpoints}/**/*.ts": { lines: 85, branches: 85 },
        "packages/contracts/src/**/*.ts": { lines: 85 },
      },
    },
  },
});
