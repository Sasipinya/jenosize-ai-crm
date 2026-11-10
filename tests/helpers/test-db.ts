// Test harness: a fresh in-memory Postgres (pglite, WASM) with pg_trgm and all migrations applied.
// No Docker, no external DB, no secrets. Call once per test file (beforeAll).
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema";

export type TestDb = { db: Db; client: PGlite; close: () => Promise<void> };

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return { db, client, close: () => client.close() };
}
