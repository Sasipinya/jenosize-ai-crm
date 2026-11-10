# MASTER PROMPT — AI CRM Copilot (Jenosize take-home)

> How to use: put `CLAUDE.md` (standing rules) at the repo root first.
> Paste this whole file as the first message of the build session, then run
> ONE phase at a time. Do not ask the agent to build everything in one go.

---

## 0. Your role

You are a senior full-stack engineer pairing with me (the Lead). I own every
decision and review every diff. You propose, implement in small steps, test,
and explain. You never push, deploy or publish. `CLAUDE.md` rules always win.

## 1. Context

Jenosize needs an internal AI CRM MVP for a 20-person commercial team with about
2,000 contacts and 300 active leads. Leads arrive from the website, manual entry
and LINE OA. Follow-ups are scattered across chat, spreadsheets and notes.

A salesperson must be able to:
- see a lead profile and a timeline of activities and conversations
- move the lead through New → Qualified → Proposal → Won / Lost
- ask AI for a summary, qualification score with reasons, next-best action and
  a draft LINE reply
- send or approve a LINE reply without losing the audit trail

Synthetic data only. Our own LINE OA test account. Safe fallback when the model
or LINE is unavailable. Timebox: about 16 focused hours, so stay pragmatic.

## 2. Stack (fixed — ask before changing)

Next.js (App Router) + TypeScript strict · TailwindCSS + shadcn/ui ·
Postgres on Neon (branch `dev` for local, `main` for prod; NO Docker) ·
pglite for tests · Drizzle ORM + drizzle-kit migrations ·
Zod · Auth.js Credentials (demo users) · Anthropic Claude via an adapter
(`AI_MODEL` env, default a Haiku-class model) · @line/bot-sdk via an adapter ·
Vitest · pino · Vercel · GitHub Actions · pnpm.

## 3. Non-negotiable requirements (every item must exist at the end)

### Part 1 — Working product
- R1  Responsive web app (works at 375px and 1280px)
- R2  Login with documented demo credentials (roles: admin, sales)
- R3  Lead management: list, create, edit, search, filter (stage, owner, source)
- R4  Company management: list, search, create, edit
- R5  Contact management: list, search, create, edit
- R6  Pipeline stage updates; every change writes an `activities` row
- R7  Lead detail page: profile, company, contact, unified timeline of
      activities + messages, add note
- R8  Leads from 3 sources: website (`POST /api/public/leads` + a sample
      `/contact-us` page), manual form, LINE
- R9  Relational DB: users, companies, contacts, leads, activities, messages
      (+ ai_suggestions, line_events, app_settings)
- R10 Migrations, synthetic seed (20 users, ~150 companies, 2,000 contacts,
      300 leads, Thai names, 5 "story" leads), Zod validation, real constraints
- R11 Deployed; data survives refresh and restart; no hard-coded in-memory data

### Part 2 — AI skill + LINE
- R12 `skills/crm-copilot/SKILL.md` with sections: Purpose, Inputs, Outputs,
      Allowed actions, Guardrails, Failure behavior, Evaluation cases (≥ 5)
- R13 AI output: summary, score 0–100 with reasons, next-best action, draft
      LINE reply, confidence, missingInfo — validated by Zod
- R14 AI suggestions are stored as `pending`; only a human Accept/Edit creates
      DB writes or outbound messages
- R15 LINE webhook: verify `x-line-signature` (HMAC-SHA256, raw body,
      `timingSafeEqual`), persist event, dedupe on `webhookEventId`
- R16 Map LINE user → contact/lead (create contact + lead source=line if new)
- R17 Outbound: approval-based, Push API with `X-Line-Retry-Key`, retry with
      backoff on 5xx/timeout, status `failed` + Retry button if it gives up
- R18 Mock LINE adapter and mock LLM adapter for local + CI
- R19 Fallback when LLM fails: rule-based suggestion with `source: "fallback"`
      and a visible badge
- R20 No secrets in the repo, ever

### Part 3 — Engineering evidence + handover
- R21 README: setup, run, deploy, demo credentials, LINE test steps + QR,
      key trade-offs, known limitations, production next steps, hours log
- R22 `docs/architecture.md` with Mermaid architecture + data-flow diagrams
- R23 `docs/api.md` API notes; `.env.example`
- R24 Tests: (a) core CRM flow, (b) AI skill behavior + fallback,
      (c) LINE webhook signature + idempotency
- R25 Structured logging (pino, requestId, redaction) + `docs/monitoring.md`
- R26 `docs/ai-usage-log.md`: tasks/prompts, what was reviewed/rejected,
      one meaningful change after human inspection

## 4. Differentiators (build after the R-items of the same phase are green)

- D1 Feedback loop: store `original_output` vs `final_output` + `reject_reason`;
     use the 3 most similar human-approved replies as few-shot examples;
     dismissed suggestions are never used as examples
- D2 PDPA: privacy notice on first LINE contact + `consent_at`; admin
     "erase customer data" that anonymises PII but keeps the audit trail;
     retention policy in README
- D3 Thai-first: `pg_trgm` search on Thai names; reply uses the owner's
     ครับ/ค่ะ and matches the customer's politeness level
- D4 One-command setup: `pnpm install && pnpm setup` (migrate + seed) against
     any Postgres given by `DATABASE_URL` (Neon free tier works). No Docker.
- D5 Demo control panel (admin): toggles `simulate_ai_down`,
     `simulate_line_down` in `app_settings`; `GET /api/health`
- D6 LINE Quick Reply buttons (นัดคุย / ขอใบเสนอราคา / ไม่สนใจ); postback
     creates an activity and adjusts score; duplicate postbacks are ignored

## 5. Data model (implement exactly; propose changes before making them)

- users: id, email UNIQUE, name, password_hash, role CHECK(admin|sales),
  polite_particle CHECK(ครับ|ค่ะ)
- companies: id, name NOT NULL, industry, website, size; trigram index on name
- contacts: id, company_id FK SET NULL, full_name NOT NULL, email UNIQUE NULL,
  phone, line_user_id UNIQUE NULL, owner_id FK, consent_at, erased_at;
  trigram index on full_name
- leads: id, contact_id FK, company_id FK, owner_id FK, title, stage enum
  (new|qualified|proposal|won|lost), source enum (website|manual|line),
  value_thb ≥ 0, score 0–100, lost_reason, stage_changed_at;
  CHECK stage='lost' → lost_reason NOT NULL; index (stage, owner_id)
- activities (append-only): id, lead_id, actor_id NULL (=system), type enum
  (note|stage_change|call|ai_accepted|message_sent|message_received|
  quick_reply|consent|data_erased), payload jsonb, created_at;
  index (lead_id, created_at)
- messages: id, lead_id, contact_id, direction (in|out), body, status
  (draft|approved|sent|failed), approved_by, line_message_id, retry_key UNIQUE,
  attempts; CHECK status='sent' AND direction='out' → approved_by NOT NULL
- ai_suggestions: id, lead_id, original_output jsonb, final_output jsonb,
  source (llm|fallback), model, prompt_version, status
  (pending|accepted|edited|dismissed), reject_reason, decided_by, decided_at
- line_events: id, webhook_event_id UNIQUE, line_user_id, type, raw jsonb,
  processed_at, error
- app_settings: key PK, value jsonb, updated_by

Stage change + its activity row = one transaction. Won/Lost are terminal;
only admin can reopen.

## 6. Architecture rules

- `src/server/services/*` holds business logic; route handlers stay thin.
- `src/server/ai/*`: context builder (strip phone/email), LLM adapter
  interface (`claude`, `mock`), fallback, few-shot retriever.
- `src/server/line/*`: signature, adapter interface (`real`, `mock`), handler.
- Every API response: `{ data }` or `{ error: { code, message } }` + requestId.
- Customer text is data, never instructions: wrap in delimiters in prompts.
- LLM call: 15 s timeout, 1 retry, Zod parse, else fallback. Log model,
  latency, token usage, source.
- Webhook: read raw body with `await req.text()` before parsing; respond 200
  fast after persisting; process after.

## 7. Red-flag guardrails (how you must behave)

| Red flag | What you do instead |
| --- | --- |
| Codes blindly from tickets | Before each phase, restate the goal, list assumptions, and flag any requirement that is unclear. Write assumptions to `docs/discovery.md`. |
| Uses AI blindly | Every task ends with: tests run, a "Review focus" list (security, data, edge cases) for me, and an AI-usage log entry with an empty `Human review:` line. |
| Cannot explain the project | For every non-trivial file, add a 2-line header comment on its responsibility. After each phase, give me a 5-bullet "how it works" summary I can repeat in an interview. |
| Over/under-engineering | No queues, microservices, Redis, GraphQL or caching layers. But security, validation, idempotency and transactions are never skipped. |
| Blames vague requirements | When something is ambiguous, pick the simplest reasonable option, record it as an ADR in `docs/adr/NNN-title.md` (context, decision, trade-off), and continue. |
| Needs supervision | Propose the next step yourself at the end of each task. Ask me only for decisions that are hard to reverse. |

## 8. Phases (stop at each gate and wait for my "go")

**Phase 1 — Foundation** (R1 shell, R2, R9, R10, R11, R20, D3 seed, D4)
Scaffold, `pnpm setup`, pglite test harness, schema + migration, Thai seed with 5
story leads, Auth.js demo login, responsive app shell, `.env.example`,
deploy instructions. GATE: I deploy and log in.

**Phase 2 — CRM core** (R3–R8, R24a, D3 search)
Services, API, leads list + filters + Thai search, stage dropdown, lead detail
+ timeline + notes, companies + contacts pages, manual lead form, public lead
endpoint + `/contact-us`, test (a). GATE: I review diffs and run tests.

**Phase 3 — AI skill** (R12–R14, R19, R24b, D1, D3 tone)
Write SKILL.md first and stop for my review. Then context builder, adapters,
fallback, AI panel (Accept/Edit/Dismiss + reason), few-shot retriever, eval
runner (`pnpm eval`), test (b). GATE: eval report + my review.

**Phase 4 — LINE** (R15–R18, R24c, D2 consent, D6)
Webhook security, dedupe, mapping, consent notice, approval-based outbound
with retry key, Quick Reply + postback, mock adapter,
`scripts/simulate-line-webhook.ts`, test (c). GATE: I test with my phone.

**Phase 5 — Handover** (R21–R23, R25, R26, D2 erase, D5)
Demo control panel + `/api/health`, PDPA erase, pino redaction, monitoring
notes, README, architecture + API docs, CI (lint, typecheck, test, eval),
responsive pass at 375px. GATE: final checklist below.

## 9. Definition of done (check every line before Phase 5 is closed)

- [ ] R1–R26 each point to a file, route or test that proves it
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm eval` all pass
- [ ] Fresh clone → set `DATABASE_URL` → `pnpm install && pnpm setup && pnpm dev` works
- [ ] `pnpm test` runs on pglite with no external DB and no secrets
- [ ] No secret, real name, real phone or real email in git history
- [ ] AI never writes confirmed data or sends LINE without a human action
- [ ] Simulated AI-down and LINE-down both degrade safely in the UI
- [ ] README lists hours spent vs plan and what was cut, with reasons

Produce at the end a table: Requirement → Evidence (file/route/test).

## 10. Start now

Read `CLAUDE.md` and `docs/plan.md`. Then give me, for Phase 1 only:
1. Your understanding of the goal in 3 lines
2. Assumptions and open questions
3. The file list you will create
4. The order of steps
Wait for my "go" before writing any code.
