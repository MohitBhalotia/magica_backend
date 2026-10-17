import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 doesn't load env files itself. A missing .env.local is fine: CI/Vercel set real env vars.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Migrations use Neon's direct endpoint; the app uses the pooled DATABASE_URL (src/lib/db.ts).
  // process.env (not env()) so validate/generate work without a DB URL, e.g. in CI builds.
  datasource: { url: process.env.DIRECT_URL },
});
