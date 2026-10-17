import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

export default defineConfig([
  ...nextVitals,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "no-console": "error",
      "@next/next/no-html-link-for-pages": "off", // API-only app, no pages
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"], // RULES §2
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // eslint-plugin-import ships with eslint-config-next, so no import-x dependency
      "import/no-cycle": "error",
      "import/no-default-export": "error",
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          pathGroups: [
            { pattern: "@agent-chat/contracts", group: "external", position: "after" },
            { pattern: "@/**", group: "internal" },
          ],
          pathGroupsExcludedImportTypes: ["builtin"],
          "newlines-between": "always",
          alphabetize: { order: "asc" },
        },
      ],
    },
  },
  {
    // Next.js and tool configs require default exports
    files: ["*.config.{ts,mjs}", "src/proxy.ts", "src/app/**/{page,layout}.tsx"],
    rules: { "import/no-default-export": "off" },
  },
  { files: ["**/*.mjs"], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "**/dist/**", "next-env.d.ts"]),
]);
