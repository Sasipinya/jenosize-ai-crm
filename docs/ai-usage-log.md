# AI-usage log

One entry per task. The agent fills in everything except `Human review:`, which the Lead completes.

---

## 2026-11-10 · Phase 1: Foundation

**Task:** Scaffold the app, DB schema + migrations, pglite test harness, Thai synthetic seed with 5 story leads, demo login, responsive shell, deploy docs.

**Prompt summary:** MASTER_PROMPT §10 → Phase 1 plan → Lead answered 7 questions (`pnpm db:setup`, approved dependency list, `pg` + Neon pooler, public demo password, `activities.lead_id` NOT NULL, append-only trigger, skip reviewer subagent).

**What the agent produced:**
- Next 16 + TS strict + Tailwind 4 + hand-copied shadcn components. Next telemetry forced off via `scripts/next.mjs`.
- `src/server/db/schema.ts`: 9 tables with CHECK/UNIQUE/FK/trigram indexes. 3 migrations: `pg_trgm`, schema, activities append-only trigger.
- `src/server/db/seed.ts`: deterministic Thai seed (20 / 150 / 2,000 / 300) + 5 story leads with fixed IDs. `pnpm db:setup`.
- NextAuth v4 Credentials + JWT, `src/proxy.ts` guard, login page, sidebar / bottom-nav shell.
- 24 tests: schema constraints, seed, auth, logger redaction.
- Docs: discovery, deploy, ADR 001–006.

**Agent self-corrections worth reviewing:**
- First draft of the timing-equalising dummy bcrypt hash was a made-up string. It might not be a valid hash, and then the equalisation does nothing. Replaced with a real hash generated at runtime.
- Planned `pnpm setup`, then found it is a pnpm built-in → `db:setup` (ADR 005).
- ESLint 10 and TypeScript 7 broke peer ranges → pinned 9.x / 6.0.x.
- Checked, rather than assumed, that `process.loadEnvFile` does not override shell variables before documenting the prod seed command.

**Human review:**
