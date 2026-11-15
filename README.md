# AI CRM (Jenosize take-home)

[![CI](https://github.com/Sasipinya/jenosize-ai-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/Sasipinya/jenosize-ai-crm/actions/workflows/ci.yml)

An internal CRM MVP for a 20-person commercial team. Leads arrive from the website form, manual entry and LINE Official Account chat; a salesperson moves them through New → Qualified → Proposal → Won/Lost, asks an AI copilot for a summary, a score with reasons, a next action and a draft Thai reply, and approves every outgoing LINE message. The AI only suggests: nothing it produces changes data or reaches a customer until a person accepts it, and every approval leaves an audit row. Synthetic data only.

- **Deployed:** https://jenosize-ai-crm-mu.vercel.app
- **Privacy notice (public):** `/privacy`

## Demo credentials

Demo-only password, public on purpose ([ADR 004](docs/adr/004-demo-credentials.md)); it protects no real data.

| Role | Email | Password |
| --- | --- | --- |
| admin | `admin@example.com` | `DemoCRM-2026!` |
| sales | `sales@example.com` | `DemoCRM-2026!` |

The seed takes the password from `SEED_DEMO_PASSWORD`; `.env.example` and `docs/deploy.md` use this same value.

## Try the LINE flow

![LINE OA QR code](docs/line-qr.png)

1. Scan the QR code and add the test Official Account, then send it any message.
2. You get one automatic reply, the fixed privacy notice (the only automatic message the system sends; see [docs/pdpa-line-notice.md](docs/pdpa-line-notice.md)).
3. In the CRM, a new lead (source LINE) appears with your message in its timeline.
4. Open it, press **Refresh suggestion**, then Accept, Edit or Dismiss. Write or accept a reply and send it: it arrives in your LINE chat.
5. Tap the Quick Reply buttons (นัดคุย / ขอใบเสนอราคา / ไม่สนใจ) on that reply and watch the score and timeline change.

Without a LINE account you can drive the webhook locally: `pnpm line:simulate` (signed payloads, localhost only).

## Local setup

Needs Node 22+, pnpm and any Postgres URL (Neon free tier works). No Docker.

```bash
pnpm install
cp .env.example .env.local     # fill in DATABASE_URL, NEXTAUTH_SECRET, SEED_DEMO_PASSWORD
pnpm db:setup                  # migrate + seed (not `pnpm setup`: pnpm reserves that name, see docs/adr/005)
pnpm dev
```

`LINE_ADAPTER` and `AI_ADAPTER` default to `mock`, so the app runs with no LINE or Anthropic account. Deploying to Vercel + Neon: [docs/deploy.md](docs/deploy.md).

```bash
pnpm lint && pnpm typecheck && pnpm test   # tests use in-memory pglite: no database, no secrets
pnpm eval                                  # AI eval cases against the mock model (deterministic)
pnpm eval --adapter claude                 # same cases against the real model; needs ANTHROPIC_API_KEY, costs a few cents, appends to docs/eval-report.md
```

## Requirements → evidence

Every requirement from the brief, with where to find it. "Not done" means it is not in the code.

| Req | What | Status | Evidence |
| --- | --- | --- | --- |
| R1 | Responsive 375px / 1280px | Done, not systematically verified | Sidebar on desktop, top bar + bottom nav on mobile: `src/app/(crm)/layout.tsx`, `src/components/app-shell/`. Checked by hand by the owner; no automated test and no screenshots in this README |
| R2 | Login, admin + sales | Done | `src/server/auth.ts`, `src/app/(auth)/login/`, `tests/auth.test.ts` |
| R3 | Lead list/create/edit/search/filter | Done | `src/app/(crm)/leads/`, `src/server/services/leads.ts`, `tests/crm-flow.test.ts` |
| R4 | Companies | Done | `src/app/(crm)/companies/`, `src/server/services/companies.ts`. Create/edit has no dedicated test |
| R5 | Contacts | Done | `src/app/(crm)/contacts/`, `src/server/services/contacts.ts`. Create/edit has no dedicated test beyond duplicate email |
| R6 | Stage change writes an activity | Done | `changeStage` (`leads.ts`), one transaction; `tests/crm-flow.test.ts`. No test forces a rollback |
| R7 | Lead detail + unified timeline + notes | Done | `src/app/(crm)/leads/[id]/page.tsx`, `src/lib/timeline.ts`, `tests/timeline.test.ts` |
| R8 | Website, manual and LINE sources | Done | `POST /api/public/leads` + `/contact-us`; `leads/new`; LINE webhook. `tests/crm-flow.test.ts`, `tests/line-webhook.test.ts` |
| R9 | Relational schema | Done | `src/server/db/schema.ts` (9 tables) |
| R10 | Migrations, Thai seed, constraints | Done | `drizzle/` (4 migrations, append-only trigger on `activities`), `src/server/db/seed.ts` (20 / 150 / 2,000 / 300, 5 story leads), `tests/seed.test.ts`, `tests/schema-constraints.test.ts` |
| R11 | Deployed, persistent | Done | Vercel + Neon, [docs/deploy.md](docs/deploy.md) |
| R12 | `SKILL.md` with 7 sections, ≥ 5 cases | Done | [skills/crm-copilot/SKILL.md](skills/crm-copilot/SKILL.md), 16 cases in `skills/crm-copilot/evals/cases.json` |
| R13 | Zod-validated AI output | Done | `skills/crm-copilot/schema.ts`, `ai-generate.ts` |
| R14 | Suggestions pending until a human decides | Done | `ai-suggestions.ts` (`decideSuggestion`), `tests/ai-suggestions.test.ts` |
| R15 | Webhook signature + dedupe | Done | `line/signature.ts`, `line/webhook.ts`, `tests/line-webhook.test.ts` |
| R16 | LINE user → contact/lead | Done | `line/inbound.ts`, `tests/line-webhook.test.ts` |
| R17 | Approved outbound, retry key, backoff, Retry | Done | `line/outbound.ts`, `line/push.ts`, `tests/line-outbound.test.ts` |
| R18 | Mock LINE + mock LLM | Done | `line/adapter.ts`, `ai-adapters.ts` (both default to mock) |
| R19 | Fallback + visible badge | Done | `skills/crm-copilot/fallback.ts`, `ai-panel.tsx`, `tests/ai-suggestions.test.ts` |
| R20 | No secrets in the repo | Partly | `.env*` ignored; `pnpm lint` runs `scripts/check-env-example.ts` on `.env.example`. A real key was once committed to `.env.example` and rotated (see the usage log). No gitleaks run and no history scan |
| R21 | README | Done (this file) | Missing: screenshots |
| R22 | Architecture diagrams | Done | [docs/architecture.md](docs/architecture.md) |
| R23 | API notes, `.env.example` | Done | [docs/api.md](docs/api.md), `.env.example` |
| R24 | Tests (a) CRM (b) AI + fallback (c) LINE | Done | `tests/crm-flow.test.ts`, `tests/ai-*.test.ts`, `tests/line-webhook.test.ts` |
| R25 | pino, requestId, redaction, monitoring doc | Done | `src/server/logger.ts`, `src/server/http.ts`, [docs/monitoring.md](docs/monitoring.md). Logging only: no alerts are configured |
| R26 | AI-usage log | Done | [docs/ai-usage-log.md](docs/ai-usage-log.md) |
| D1 | Feedback loop | Done | `original_output`/`final_output`/`reject_reason`; few-shot from approved replies, never dismissed ones: `ai-suggestions.ts`, `tests/ai-suggestions.test.ts`. No admin UI for the few-shot switch and no metrics page |
| D2 | PDPA | Partly | Notice on first LINE contact + `consent_at`: done (`line/notice.ts`, `/privacy`). **Admin "erase customer data": not done** (the `erased_at` column and the guards that block editing/sending to an erased contact exist; nothing sets it). **Automatic deletion: not implemented** (the policy below is decided, enforcement is manual; see [Production next steps](#production-next-steps)) |
| D3 | Thai-first | Done | `pg_trgm` indexes + Thai search tests; owner's ครับ/ค่ะ enforced in code: `skills/crm-copilot/particles.ts` |
| D4 | One-command setup | Done, with a different name | `pnpm install && pnpm db:setup` (not `pnpm setup`, [ADR 005](docs/adr/005-setup-command-name.md)) |
| D5 | Demo control panel + `/api/health` | **Partly done: `/api/health` done, admin panel not done** | `GET /api/health` (`src/app/api/health/route.ts`, `src/server/services/health.ts`, `tests/health.test.ts`) reports DB, AI adapter/model/`simulatedDown`, LINE adapter and git version. The switches `simulate_ai_down` and `simulate_line_down` (in `app_settings`) are read by the code and tested, but only the seed or a SQL update can change them: no admin page, no API to flip them |
| D6 | LINE Quick Reply | Done | `line/notice.ts`, `line/inbound.ts` (`applyPostback`), `tests/line-webhook.test.ts`, `tests/quick-reply-score.test.ts` |

CI: `.github/workflows/ci.yml` runs install (frozen lockfile), lint, typecheck, test and the mock eval on every push and pull request, with no secrets. It has not been run on GitHub yet: check the first run (the badge above shows the status once the repo is on GitHub).

## AI design

- **Suggestion vs confirmed write.** The model returns JSON that is stored as a `pending` row in `ai_suggestions`. Only a person's Accept or Edit updates the lead score and writes an `ai_accepted` activity, in one transaction; Dismiss changes only the suggestion. The AI never sends a LINE message: outbound text goes through a person's approval and the Push API.
- **Guardrails are code, not just prompt.** Zod validation of the output; replacement of any draft that promises a price or discount; customer text is wrapped in delimiters and treated as data; phone numbers and emails are stripped from the context; Thai-only fields and no gendered wording are checked in code; the salesperson's polite particle is normalised in code; quick-reply taps are scored by code and never shown to the model, so they cannot be counted twice.
- **Fallback.** A 15 s timeout and one retry (on 5xx, 429, timeout, network errors, invalid JSON and failed language/gender checks; not on other 4xx), then a rule-based Thai suggestion with `source: "fallback"` and a visible badge. A failed Thai-only or gendered-wording check ends in the fallback; the price/discount guardrail instead replaces just the draft with a neutral one and keeps `source: "llm"` (no fallback badge).
- **PDPA.** The first message from a new LINE user gets one fixed privacy notice (no AI, sent once, links to `/privacy`); `consent_at` is set only after LINE accepted it. This is a notice, not opt-in consent: [docs/pdpa-line-notice.md](docs/pdpa-line-notice.md).
- **Full specification** (inputs, outputs, allowed actions, guardrails, failure behaviour, 16 eval cases, known limitations): [skills/crm-copilot/SKILL.md](skills/crm-copilot/SKILL.md). Eval runs, including real-model runs: [docs/eval-report.md](docs/eval-report.md).

Architecture and data-flow diagrams: [docs/architecture.md](docs/architecture.md). API reference: [docs/api.md](docs/api.md). Logging and alerts: [docs/monitoring.md](docs/monitoring.md).

## Trade-offs

- **One Next.js app** (pages + Route Handlers) instead of a separate API: one deploy, enough for 20 users and 2,000 contacts. No queue, cache layer or microservice.
- **Own `fetch` calls** to the Claude and LINE APIs instead of the SDKs: no new dependencies to approve; the LINE payload shapes and the Retry-Key behaviour were written from the docs and should be re-verified against the Messaging API reference.
- **pglite for tests** (no Docker): fast and runs anywhere, but it serialises queries, so the row-lock and concurrency guarantees are reasoned from Postgres rules, not run on real concurrent connections.
- **Demo auth** (Credentials + one shared public password) as the brief allows; see [ADR 003](docs/adr/003-auth-credentials-jwt.md).
- **Notice-based PDPA**, not opt-in consent, and a manual deletion route (see below).
- **In-memory rate limiter**: per server instance, so it limits less on several Vercel instances.
- **Haiku-class model** (`claude-haiku-5-5`) to keep cost per suggestion tiny, at the price of some regex-checked wording in the eval being brittle.

## Known limitations

The AI-specific ones are kept in one place, [skills/crm-copilot/SKILL.md](skills/crm-copilot/SKILL.md#known-limitations-general), and are not repeated here. Product-level ones:

- Erasing a customer is manual (no admin button) and there is no automatic deletion; the retention policy below is not enforced by code.
- Any logged-in user can retry any message or edit any record; only reopening a closed lead needs admin.
- No admin page for the demo switches and no alerting (only logs and the `/api/health` probe).
- Two simultaneous first messages from a contact whose leads are all closed can create two leads; an event whose processing is killed midway keeps `processed_at` and `error` both empty ([usage log](docs/ai-usage-log.md), Phase 4).
- Messages from an erased contact are still stored.
- Responsive layout was checked by hand, not by tests.

## AI cost per suggestion (estimate)

Model `claude-haiku-5-5`, **$0.10 per million input tokens and $0.50 per million output tokens** (up to 100k context; cache reads 0.1×, cache writes 1.25× the input price), as set in `src/server/services/ai-adapters.ts`. Check the [current pricing page](https://platform.claude.com/docs/en/about-claude/pricing): these are estimates, not an invoice.

From the real-model eval run of 2026-11-15 (prompt `crm-copilot/v4`, [docs/eval-report.md](docs/eval-report.md)): about 180–350 uncached input tokens, 1,461 cached system-prompt tokens and 370–705 output tokens per call, which is **$0.0002–$0.0004 per suggestion, about $0.0003 on average (roughly $0.33 per 1,000 suggestions)**. Worked example (case 7): 256 × $0.10/M + 705 × $0.50/M + 1,461 × $0.01/M ≈ $0.00039. Output tokens are about 90% of the cost.

Caveats: the eval conversations are short, and real leads send up to 20 recent events, so input will be larger; a retried call costs twice; a cached suggestion (no new event) costs nothing; a cache miss on the system prompt adds roughly $0.0002 once. The current prompt (v5) has not been measured with the real model. The app logs `estimatedCostUsd` on every call ([docs/monitoring.md](docs/monitoring.md)) and the Anthropic console has a monthly spending limit.

## Hours: plan vs actual

The plan is 16 h ([docs/plan.md](docs/plan.md)). Actual hours are the owner's own figures (the plan's "actual" column, as corrected by the owner). The AI-usage log has an hours line for one task only (Phase 4 follow-up, 1.3 h); the rest are not logged there.

| Phase | Plan | Actual | Note |
| --- | --- | --- | --- |
| 1 Foundation | 3 h | 2.1 h | |
| 2 CRM core | 3.75 h | 0.5 h | |
| 3 AI skill + feedback loop | 3.25 h | 2.2 h | |
| 4 LINE + PDPA + Quick Reply | 3.5 h | 1.3 h | Matches the log's 1.3 h line (double-send fix and real LINE test, 14 Nov 20:30–21:45) |
| Prod-test fixes (Thai-only output, score on Accept, no gendered wording, quick-reply double count, eval pattern changes) | not planned | 1.4 h | 15 Nov, 10:44–12:05 |
| 5 Handover | 2.5 h | in progress | Owner will fill in |
| **Total so far (phases 1–4 + prod-test fixes)** | 13.5 h (phases 1–4) of 16 h | **7.5 h** | Excludes Phase 5 |

Planning and research time (reading docs, account setup, designing the plan) is not counted.

### What was cut, and why

| Cut | Reason |
| --- | --- |
| Admin "erase customer data" button (D2) | In the plan's own cut order ([docs/plan.md](docs/plan.md), "ความเสี่ยงและสิ่งที่ตัดได้"): "write it as a next step instead". Deletion is manual for now |
| Demo control panel (D5; `/api/health` was built) | Also in the plan's cut order ("use env toggles instead"); the switches work at the database level |
| AI quality metrics page, few-shot admin UI, devcontainer | Listed in the plan as "if time allows"; not built |
| Screenshots in README, gitleaks run | Not done in this phase |

These reasons come from the plan's pre-agreed cut order and the Phase 5 timebox; the owner should confirm or correct them.

## Production next steps

1. **PDPA (not implemented: the erase action and automatic deletion):** build the erase action (anonymise the contact, keep the audit trail, write `data_erased`); implement automatic deletion for the retention policy (LINE data kept while the lead is active, deleted within 30 days of a request) and reset the demo data after the review period; stop storing messages from erased contacts; add an explicit opt-in step if marketing messages are planned; have counsel review the notice and `/privacy`.
2. **Access control:** per-record ownership and role checks beyond "admin reopens closed leads"; a real identity provider (SSO) instead of the shared demo password; rate limit sign-in.
3. **Reliability:** an uptime check on `/api/health`; ship logs to a log drain and wire the alerts in [docs/monitoring.md](docs/monitoring.md); a shared rate limiter (the in-memory one is per instance); a recovery job for LINE events whose processing was killed midway.
4. **CI and security:** add the real-model eval as a manual or nightly job; `gitleaks` on the history; dependency audit; rotate the LINE and Anthropic keys on a schedule.
5. **AI quality:** run the real-model eval before each prompt change and keep the report; replace regex checks on free text with a structured `flags` field in the output (for example a prompt-injection flag); give the model a code-computed "customer declined" signal so it does not propose a follow-up after ไม่สนใจ; measure real cost per suggestion with production-size context.
6. **LINE:** re-verify payload shapes and Retry-Key behaviour against the Messaging API reference; handle multi-instance webhook races on real Postgres and load-test concurrency (pglite cannot).
7. **Product:** admin page for the demo switches and few-shot switch, AI-quality metrics (acceptance/edit rate per prompt version), automated responsive checks at 375 px.

## How AI was used

Claude Code did the implementation in small, reviewed steps under the rules in `CLAUDE.md`: plan first, human approval, tests, an independent reviewer pass on non-trivial diffs, and a commit only after the owner's approval; nothing was pushed by the agent. [docs/ai-usage-log.md](docs/ai-usage-log.md) records each task, what the agent produced, its self-corrections, what the owner rejected or changed, and one meaningful change after human inspection (the Vercel `PUBLIC_` env-var rename, and real-LINE test bugs found by the owner). The product's own AI feature is described in [AI design](#ai-design).

## Docs

[Plan](docs/plan.md) · [Assumptions](docs/discovery.md) · [Decisions (ADRs)](docs/adr/) · [Deploy](docs/deploy.md) · [Architecture](docs/architecture.md) · [API](docs/api.md) · [Monitoring](docs/monitoring.md) · [PDPA notice](docs/pdpa-line-notice.md) · [AI skill](skills/crm-copilot/SKILL.md) · [Eval report](docs/eval-report.md) · [AI-usage log](docs/ai-usage-log.md)
