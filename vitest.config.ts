import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
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
        },
      },
    ],
    coverage: {
      provider: "v8",
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
