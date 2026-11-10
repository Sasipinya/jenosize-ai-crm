# Discovery: assumptions and open questions

Living list. Each phase adds what it assumed and what we would ask the client.

## Phase 1: Foundation (2026-11-10)

### Decisions confirmed by the Lead

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Setup command | `pnpm db:setup` (pnpm's built-in `setup` shadows a script named `setup`). ADR 005 |
| 2 | Dependencies | Approved list; recorded in ADR 006 |
| 3 | DB driver | `pg` (node-postgres). On Vercel use Neon's pooled `-pooler` URL. ADR 002 |
| 4 | Demo password | Public in README and `.env.example`, demo-only. ADR 004 |
| 5 | `activities.lead_id` | NOT NULL as specified; PDPA erase writes one row per lead |
| 6 | Append-only | DB trigger rejects UPDATE / DELETE / TRUNCATE on `activities`; no PII in `payload` |

### Assumptions made in Phase 1

- **Auth library:** `next-auth` v4.24 (stable), not v5 (still beta on npm). v4 lists Next 16 as a supported peer. ADR 003.
- **Next 16 proxy:** route guard lives in `src/proxy.ts` (Next 16 renamed `middleware` to `proxy`, Node runtime). The proxy is only the first check; pages and route handlers check the session again.
- **Owner can be empty:** `contacts.owner_id` and `leads.owner_id` are nullable FKs, so LINE and website leads can arrive unassigned.
- **Extra constraints beyond section 5** (all "real constraints"; none change the shape):
  `users.email` must be lowercase; company and contact names must not be blank; `messages.attempts >= 0`;
  `lost_reason` must be non-blank, not just non-NULL; `ai_suggestions` with a non-pending status must have `decided_by` and `decided_at`.
- **`value_thb` is an integer** (whole baht). Enough for this market and avoids numeric-as-string handling.
- **`score` is nullable** (unscored until AI or a rule scores it), with a CHECK of 0–100.
- **Seed is deterministic** (fixed faker seed) and **only runs on an empty DB** (skips if any user exists). We can't reset by deleting rows, because the activities trigger blocks DELETE. To reset, use a fresh Neon branch.
- **Synthetic PII:** emails are `@example.com` only; phones start with `000-`, which no Thai number does; LINE user IDs are random `U` + 32 hex.
- **Story leads** map to eval cases 1, 2, 3, 4 and 6 (case 5 is an LLM failure and needs no data). They have fixed UUIDs (`STORY_LEAD_IDS` in `src/server/db/seed.ts`) and belong to `sales@example.com`.
- **Fonts:** system Thai-capable font stack, no Google Fonts download at build.
- **Telemetry:** Next.js telemetry is forced off by `scripts/next.mjs`. `next dev` reads the flag before `.env` files load, so `.env.local` alone is not enough.

### Open questions (for the client / the Lead)

1. **Thai trigram search on Neon.** pglite produces trigrams for Thai text (tested). Whether Neon does depends on its database locale (`LC_CTYPE`). ILIKE substring search works either way. Fuzzy `similarity()` ranking may not. Check at the gate:
   `SELECT similarity('สมชาย ใจดี', 'สมชาย');` should return a value > 0.3.
2. Contact **job title / position**: `docs/plan.md` lists it as AI input, but section 5 of the data model has no such column. Proposal: add `contacts.job_title text NULL` in Phase 2. Waiting for approval.
3. Lead assignment rule for unassigned LINE / website leads (round-robin? a fixed inbox owner?). Phase 4 default: unassigned, visible to all.
4. Login brute-force protection: none in the MVP (demo users only). Production next step: rate limit per IP + email.
