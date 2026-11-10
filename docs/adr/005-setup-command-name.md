# ADR 005: One-command setup is `pnpm db:setup`

Status: accepted · 2026-11-10

## Context
D4 asks for `pnpm install && pnpm setup`. But `pnpm setup` is a built-in pnpm command (it configures `PNPM_HOME`), and built-ins win over package scripts with the same name. So `pnpm setup` would never run our script.

## Decision
- `pnpm db:setup` = migrate + seed (`scripts/setup.ts`). It works with any Postgres in `DATABASE_URL`, and re-running is safe (migrations are tracked; the seed skips a non-empty DB).
- Also available separately: `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:generate`.
- CLI scripts load `.env.local` if present (`process.loadEnvFile`), otherwise use the real environment.

## Trade-offs
- The command differs from the wording in the brief; the README calls this out.
