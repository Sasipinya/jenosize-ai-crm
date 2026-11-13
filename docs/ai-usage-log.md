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

**Human review:ตรวจแผนก่อนให้ลงมือ, ตอบ 6 คำถาม (เลือก pg แทน Neon HTTP driver เพราะต้องใช้ transaction), ทดสอบ login และ responsive เองทั้งในเครื่องและบน production, deploy เอง**

---

## 2026-11-12 · Phase 2: CRM core

**Task:** Services, Route Handlers, leads list/detail/new, companies and contacts pages, website intake + `/contact-us`, crm-flow test.

**Prompt summary:** "go Phase 2" → plan.md day 2 + MASTER_PROMPT Phase 2 scope (R3–R8, R24a).

**What the agent produced:**
- Services in `src/server/services` (leads, contacts, companies, activities), `errors.ts`, `http.ts` (`withAuth`, standard error shape, requestId), in-memory `rate-limit.ts`.
- 11 route handlers under `src/app/api` (Zod at the boundary; public intake uses API key + rate limit + honeypot).
- Pages: leads list (filters, paging, inline stage select), lead detail (profile, edit, notes, timeline), new lead, companies and contacts (list, new, edit), `/contact-us`.
- `tests/crm-flow.test.ts`: 13 tests (stage change + activity, lost needs reason, terminal stages, Thai search, LIKE escaping, website intake, honeypot, rate limit).
- ADR 007. `LEAD_INTAKE_API_KEY` added to `.env.example`.

**Agent self-corrections worth reviewing:**
- First batch of route files was lost to a shell heredoc parse error; noticed nothing was written and recreated them.
- Stage select first imported `LEAD_STAGES` from the schema, pulling drizzle into the client bundle; replaced with a local list that `satisfies` the schema type.
- Removed an unused `recentCompanies` helper and a leftover `void z` line.

**Human review:**

## 2026-11-12 — Rename PUBLIC_LEAD_API_KEY to LEAD_INTAKE_API_KEY

**Prompt summary:** Rename the env var everywhere (Vercel rejects the PUBLIC_ prefix as a Secret); confirm the key is only read server-side and `/contact-us` never sends it from the browser.

**Produced:**
- Renamed in `.env.example`, `src/app/api/public/leads/route.ts` and this log. No test or ADR referenced the old name.
- Verified: the key is read only in the route handler (`process.env.LEAD_INTAKE_API_KEY`). `/contact-us` submits via a server action that calls `createWebsiteLead` directly and never uses the key. No code change needed there.

**Human review:**
- ให้ reviewer agent อีกตัวตรวจ diff ของ Phase 2 รอบแรกได้ผล FAIL (ปัญหาที่ต้องแก้ 2 ข้อ, ข้อเล็ก 5 ข้อ) 
แก้แล้วตรวจซ้ำรอบที่สองผ่าน:
  - error log บันทึกแค่ชื่อ error และรหัส pg ไม่บันทึกข้อความ error เพราะอาจมีข้อมูลลูกค้าติดอยู่
  - กรณี foreign key ไม่ถูกต้อง ตอบกลับเป็น 400 แทน 500
  - ฟอร์มเว็บไซต์ที่ถูกส่งพร้อมกันหลายครั้งไม่สร้าง lead ซ้ำ
  - contact ที่ถูกลบข้อมูลแล้ว แก้ไขไม่ได้
  - endpoint สาธารณะตรวจ rate limit ก่อนตรวจ API key
- การแก้ไขสำคัญหลังคนตรวจ: Vercel ไม่ยอมเก็บ PUBLIC_LEAD_API_KEY เป็น Secret เพราะชื่อขึ้นต้นด้วย PUBLIC_ ซึ่งหมายถึงค่าที่ส่งไปฝั่งเบราว์เซอร์ได้ จึงเปลี่ยนชื่อเป็น LEAD_INTAKE_API_KEY และให้ agent ยืนยันว่า key ถูกอ่านเฉพาะฝั่ง server ไม่ถูกส่งจากเบราว์เซอร์
- ทดสอบเองทั้งในเครื่องและบน production: ค้นชื่อภาษาไทย, กรองตาม stage, เปลี่ยน stage แล้วเกิด activity, timeline ในหน้า lead detail, เพิ่ม note, สร้าง/แก้ไข company และ contact, ส่งฟอร์ม /contact-us แล้วได้ lead ที่ source = website, และหน้าจอบนมือถือ

## 2026-11-13 — Phase 3: write skills/crm-copilot/SKILL.md (no code yet)

**Prompt summary:** Write SKILL.md first with all 7 sections and at least 5 eval cases, then stop for review. Anthropic Claude only; mock adapter for tests/CI; cost controls (max_tokens ~800, 20 events, prompt caching, per-lead cache, token/cost logging).

**Produced:**
- `skills/crm-copilot/SKILL.md` with Purpose, Inputs, Outputs, Allowed actions, Guardrails, Failure behavior, Evaluation cases (10).
- No code written. Waiting for human review.

**Human review:**

## 2026-11-13 — Phase 3: crm-copilot code (adapters, fallback, decisions, panel, eval runner)

**Prompt summary:** SKILL.md approved with notes. Build the AI skill: mock + Claude adapters, context builder with PII redaction (including few-shot), rule-based fallback, per-lead cache, Accept/Edit/Dismiss with reject-reason enum, decide-once guard, `pnpm eval` runner with `docs/eval-report.md` output, and a `.env.example` secret check. Replace the real-looking key in `.env.example` with a placeholder.

**Produced:**
- `skills/crm-copilot/{schema,prompt,fallback}.ts`, `evals/cases.json` (10 cases), `evals/run.ts`.
- `src/server/services/ai-{context,adapters,generate,suggestions}.ts`, routes `/api/ai/suggest` and `/api/ai/suggestions/:id/decision`, `AiPanel` on the lead page.
- Migration `drizzle/0003_*`: `reject_note` column, CHECK on `reject_reason` enum.
- `scripts/eval.ts`, `scripts/check-env-example.ts` (wired into `pnpm lint`), tests for cache, fallback, few-shot, decide-once (double, concurrent, dismiss→accept), eval cases and the secret scanner.
- Claude adapter uses `fetch` against the Messages API: no new dependency added (SDK needs your approval).

**Agent self-corrections worth reviewing:**
- First wrote Phase 3 file edits with python scripts; switched to the Edit tool when asked.
- Seed already inserts `simulate_ai_down`; the test now upserts instead of inserting.

**Human review:**
- รีวิว SKILL.md ก่อนให้เขียนโค้ด ยืนยันว่า Dismiss ไม่ต้องเขียน activity เพราะมีบันทึกใน ai_suggestions อยู่แล้ว และขอให้เพิ่ม eval-report.md ที่มีช่องให้คนให้คะแนน
- รีวิว prompt.ts แล้วพบว่า few-shot ไม่ได้ตัดเบอร์โทร/อีเมล → ให้แก้ทั้งโค้ด, SKILL.md และ eval เคส 8
- เทียบ validation กับแผนแล้วพบว่า rejectReason เป็นข้อความอิสระ ไม่ตรงกับ feedback loop ที่ต้องนับสถิติ → ให้เปลี่ยนเป็น enum 4 ค่า + note
- ขอให้กันการกด Accept ซ้ำ/พร้อมกันด้วยเงื่อนไข status = 'pending' พร้อมเทสต์ concurrent
- agent แจ้งว่า .env.example มี LEAD_INTAKE_API_KEY จริงที่ commit ไปแล้ว → rotate key ทันที (.env.local + Vercel) และให้เพิ่ม pnpm check:env ใน lint กันเกิดซ้ำ
- ตั้ง spending limit ใน Anthropic Console ($10/เดือน, ปิด auto-reload) และเลือก claude-haiku-5-5 เพื่อคุมค่าใช้จ่าย
