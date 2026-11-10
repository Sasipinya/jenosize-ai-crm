// Postgres connection for the app: one lazy node-postgres pool per process (survives dev HMR).
// Services accept a `Db` so tests can pass a pglite-backed instance instead.
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Any Drizzle Postgres database using our schema (node-postgres in the app, pglite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

const globalForDb = globalThis as unknown as { __crmPool?: Pool; __crmDb?: Db };

export function createPool(connectionString: string): Pool {
  // Small pool: on Vercel each function instance holds its own; Neon's -pooler endpoint multiplexes.
  return new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000 });
}

export function getDb(): Db {
  if (globalForDb.__crmDb) return globalForDb.__crmDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = createPool(url);
  const db = drizzle(pool, { schema });
  globalForDb.__crmPool = pool;
  globalForDb.__crmDb = db;
  return db;
}
