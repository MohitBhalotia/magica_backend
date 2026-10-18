import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "@/lib/env";

import { PrismaClient } from "../../prisma/generated/client";

// Small pool per process (DEC-016): 1k workers × 2 connections fit through Neon's pooler.
const createClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 2 }),
    // Prisma's 2s default to start a transaction is too tight when Neon wakes a suspended compute
    // or a fresh TLS connection is needed; still bounded so a stuck DB fails fast.
    transactionOptions: { maxWait: 5_000, timeout: 10_000 },
  });

// Reuse one client across Next.js dev hot reloads instead of leaking a pool per reload.
const globalForDb = globalThis as { db?: PrismaClient };

export const db = globalForDb.db ?? createClient();
if (env.NODE_ENV !== "production") globalForDb.db = db;

/** A repository's optional last param: the root client or a transaction client. */
export type DbClient = typeof db | Parameters<Parameters<typeof db.$transaction>[0]>[0];
