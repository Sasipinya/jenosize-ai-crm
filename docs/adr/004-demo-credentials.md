# ADR 004: Public demo password

Status: accepted · 2026-11-10

## Context
R2 requires documented demo credentials so reviewers can log in. CLAUDE.md forbids committing secrets.

## Decision
- All seeded users share one demo-only password from `SEED_DEMO_PASSWORD`. The documented value (`DemoCRM-2026!`) appears in `.env.example` and the README **on purpose**. It is not a secret.
- Only the bcrypt hash (cost 10) is stored in the DB. The seed refuses passwords shorter than 8 characters.
- Demo accounts: `admin@example.com` (admin) and `sales@example.com` (sales). Other seeded users are `salesNN@example.com`.
- The value must never match a real password anyone uses. The deployed demo holds synthetic data only.

## Trade-offs
- Anyone with the URL can log in. Acceptable for a synthetic-data demo; to lock it down, re-seed with a different `SEED_DEMO_PASSWORD` set only in Vercel / `.env.local`.
