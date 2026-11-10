# ADR 002: node-postgres (`pg`) as the database driver

Status: accepted · 2026-11-10

## Context
Stage change + its `activities` row must be one transaction (and later: AI accept, message approve). Neon's HTTP driver (`@neondatabase/serverless` over fetch) cannot run interactive transactions. D4 also requires "any Postgres via `DATABASE_URL`".

## Decision
- Use `pg` (node-postgres) with Drizzle's `node-postgres` adapter. One small lazy pool per process (`max: 5`), see `src/server/db/client.ts`.
- **On Vercel, `DATABASE_URL` must be Neon's pooled connection string** (host contains `-pooler`). Serverless functions open many short-lived connections; Neon's PgBouncer endpoint multiplexes them.
- Migrations may use a direct (non-pooler) URL via the optional `MIGRATION_DATABASE_URL`; otherwise they use `DATABASE_URL`.

## Trade-offs
- PgBouncer runs in transaction mode on the pooler. Drizzle with `pg` sends unnamed statements, so this works; never add named prepared statements or session-level state (`SET`, advisory locks held across transactions).
- A per-instance pool on serverless can leave idle connections; `idleTimeoutMillis: 10s` limits that. Production next step: Vercel's pool-attach helper for Fluid compute (needs a new dependency).
