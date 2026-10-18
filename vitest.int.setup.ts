import { execSync } from "node:child_process";

import { config } from "dotenv";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { z } from "zod";

// Integration tests run against a throwaway Neon branch (user choice, MEMORY 2026-10-18): a full
// copy of production (so `_prisma_migrations` exists), migrated + drift-checked, deleted after.
config({ path: ".env.local", quiet: true });

const api = () => `https://console.neon.tech/api/v2/projects/${process.env.NEON_PROJECT_ID ?? ""}`;
const neon = (path: string, init?: RequestInit) =>
  fetch(`${api()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.NEON_API_KEY ?? ""}`,
      "content-type": "application/json",
    },
  });
let branchId: string | undefined;

async function waitForDb(url: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000)); // compute still starting
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  throw new Error("Neon test branch never became reachable");
}

export async function setup(project: TestProject) {
  if (!process.env.NEON_API_KEY || !process.env.NEON_PROJECT_ID) {
    throw new Error("Integration tests need NEON_API_KEY and NEON_PROJECT_ID (see .env.example)");
  }
  const created = await neon("/branches", {
    method: "POST",
    body: JSON.stringify({
      branch: { name: `test-${String(Date.now())}`, expires_at: new Date(Date.now() + 3_600_000) },
      endpoints: [{ type: "read_write" }],
    }),
  });
  if (!created.ok) throw new Error(`Neon branch create failed: ${String(created.status)}`);
  // Recorded first, so teardown deletes the branch even if a later step fails.
  branchId = z.object({ branch: z.object({ id: z.string() }) }).parse(await created.json())
    .branch.id;

  const query = `branch_id=${branchId}&database_name=neondb&role_name=neondb_owner`;
  const uri = await neon(`/connection_uri?${query}`);
  const url = z.object({ uri: z.string() }).parse(await uri.json()).uri;

  await waitForDb(url);
  const env = { ...process.env, DIRECT_URL: url };
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });
  execSync(
    "pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code",
    { env, stdio: "inherit" },
  );
  project.provide("databaseUrl", url);
}

export async function teardown() {
  if (branchId) await neon(`/branches/${branchId}`, { method: "DELETE" });
}

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- augmentation must merge into Vitest's interface
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
