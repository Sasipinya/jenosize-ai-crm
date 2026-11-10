# ADR 001: No Docker; Neon for dev/prod, pglite for tests

Status: accepted · 2026-11-10

## Context
Reviewers and the next team must get the app running fast. Docker Desktop is a heavy prerequisite on Windows/macOS. Tests must run in CI without secrets or an external DB.

## Decision
- Dev and prod use Postgres on Neon (branch `dev` for local, `main` for prod) via `DATABASE_URL`. Any other Postgres works too.
- Tests use `@electric-sql/pglite` (real Postgres compiled to WASM, in memory) with the `pg_trgm` extension. Each test file gets a fresh DB with all migrations applied (`tests/helpers/test-db.ts`).
- The same SQL migrations in `/drizzle` run against both.

## Trade-offs
- pglite is single-connection: it can't test connection-pool or concurrency behaviour (e.g. two webhooks racing). We cover idempotency with UNIQUE constraints, which pglite does enforce.
- The locale can differ from Neon's (see discovery open question 1 on Thai trigrams).
- Local dev needs network access to Neon.
