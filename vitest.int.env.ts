import { inject } from "vitest";

// Runs in each test worker before test files import src/lib/db.ts, so the app talks to the branch.
process.env.DATABASE_URL = inject("databaseUrl");
