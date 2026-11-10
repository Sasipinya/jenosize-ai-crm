// Shared helpers for the db:* CLI scripts: load .env.local (if present), open a pool, migrate, seed.
// Works against any Postgres given by DATABASE_URL (Neon, local, CI). No Docker.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createPool } from "../../src/server/db/client";
import * as schema from "../../src/server/db/schema";
import { seedDatabase } from "../../src/server/db/seed";

export function loadLocalEnv() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: rely on the real environment (CI, Vercel, shell exports).
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return v;
}

/** Migrations prefer a direct (non-pooler) URL when given; otherwise DATABASE_URL. */
export async function runMigrations() {
  const url = process.env.MIGRATION_DATABASE_URL || requireEnv("DATABASE_URL");
  const pool = createPool(url);
  try {
    await migrate(drizzle(pool, { schema }), { migrationsFolder: "drizzle" });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

export async function runSeed() {
  const demoPassword = requireEnv("SEED_DEMO_PASSWORD");
  if (demoPassword.length < 8) {
    console.error("SEED_DEMO_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }
  const pool = createPool(requireEnv("DATABASE_URL"));
  try {
    const result = await seedDatabase(drizzle(pool, { schema }), { demoPassword });
    if (result.skipped) console.log("Seed skipped: users already exist (seed only runs on an empty DB).");
    else console.log("Seeded:", JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

export function main(fn: () => Promise<void>) {
  loadLocalEnv();
  fn().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
