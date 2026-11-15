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
- รีวิว staged diff ก่อน commit เน้นไฟล์ที่แก้ผ่านสคริปต์

## 2026-11-14 — Phase 3 follow-up: polite particle owned by the lead owner, normalised in code

**Prompt summary:** Production with the real model produced a draft that mixed particles ("สวัสดีครับ … ค่ะ … ได้ไหมคะ"): the customer wrote ครับ and the model copied it. Decide whose particle is used (the lead owner's), enforce it in the guardrails (no prompt change), add eval case 13. Then four review rounds on the masking of names; time-boxed by the owner.

**Produced:**
- `skills/crm-copilot/particles.ts` (`normalizeParticles`): owner ค่ะ → ครับ becomes ค่ะ, question endings become คะ; owner ครับ → ค่ะ/ค๊ะ/คะ become ครับ; คะแนน, คะเน, คะน้า, คะนึง etc. untouched; contact and company names masked while rewriting (single private-use characters, restored in reverse, private-use characters stripped from drafts).
- `ai-suggestions.ts` now takes the particle from the lead owner (fallback: the person who clicked); `ai-generate.ts` applies the rewrite and returns `particleNormalised`; eval report marks it and keeps the model's original draft; mock mode `mixed_particles`; eval case 13; `tests/ai-particles.test.ts`, owner-vs-clicker test in `ai-suggestions.test.ts`.
- SKILL.md: owner's particle rule, guardrail text, case 13 row and known limitations (word-list heuristic, gendered pronouns, nickname vs คะแนน collision, stored names only, private-use stripping flag).

**Agent self-corrections worth reviewing:**
- The first version rewrote real customer names that contain คะ (คะนึงนิจ → ครับนึงนิจ), found by the reviewer; fixed by masking names.
- My first "lossless masking" test passed on the old buggy masks (reviewer caught it). Rewritten with 11+ names and proven to fail on the old masks before restoring the fix.
- I had said earlier that code used the lead owner's particle: it actually used the person who clicked; fixed.

**Human review:**
ทดสอบบน production เจอ draft ใช้ ครับ/ค่ะ ปนกัน (eval ไม่จับ) → ให้บังคับในโค้ดและเพิ่ม eval เคส 13 ยืนยันบนเว็บจริงว่าแก้แล้ว และกำหนดเวลาให้งาน hardening ไม่ให้ลากยาว
## 2026-11-14 — Phase 4: LINE (webhook, mapping, PDPA notice, outbound, Quick Reply)

**Prompt summary:** Plan first, then build after "go". Webhook with raw-body HMAC verify and `ON CONFLICT DO NOTHING` dedupe, respond fast and process after; map LINE user to contact + lead (placeholder name if the profile call fails); PDPA notice on first message recorded as a `consent` activity plus `consent_at`; outbound only after human approval with `X-Line-Retry-Key`, backoff on 5xx/timeout, stop on 4xx, failed + Retry, `simulate_line_down`; Quick Reply postbacks; mock adapter by default; simulate script; R24c tests.

**Produced:**
- `src/server/services/line/{signature,notice,adapter,push,inbound,outbound,webhook}.ts`, `src/lib/validation/line.ts`.
- Routes `POST /api/webhooks/line`, `POST /api/messages`, `POST /api/messages/:id/retry`; `LineComposer` and `RetryButton` on the lead page.
- `scripts/simulate-line-webhook.ts` (`pnpm line:simulate`, localhost only), `.env.example` (`APP_URL`, `LINE_ADAPTER`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`), logger redact paths.
- `docs/pdpa-line-notice.md` (why the one automatic reply is allowed; notice-based, not explicit opt-in, not legal advice).
- `tests/line-webhook.test.ts`, `tests/line-outbound.test.ts`. No migration, no new dependency (LINE called with `fetch`).

**Agent decisions worth reviewing:**
- LINE payload shapes, the push endpoint, `X-Line-Retry-Key` and "409 = key already accepted" are written from memory of the LINE docs; verify against the Messaging API reference before the first real run.
- Notice is stored as an activity only; `consent_at` is set only after LINE accepts the notice.
- A failed event can be reprocessed by a redelivery (claimed once); other duplicates are skipped.
- Postback: every tap logs a `quick_reply` activity, but a button moves the score only once per lead (later taps record `scoreChanged: false`); a lead with no score starts at 50. (First version ignored taps within 60 s; changed on the owner's request.)
- New LINE leads are owned by the user in `LINE_DEFAULT_OWNER_EMAIL`; if unset or unknown, the first (oldest) sales user; an existing contact's own owner wins. (First version left them unowned; changed on the owner's request. Not re-reviewed.)
- Approval is recorded as a system `note` activity (no new activity type, so no migration).
- Reviewer pass: FAIL on one blocking issue (a message could stay `approved` forever if sending threw). Fixed: an unexpected error now moves it to `failed` so Retry works (test added). Also fixed: placeholder channel secret rejected, 429 no longer retried (spec: stop on 4xx), a reprocessed event no longer stores its message twice, notice errors no longer fail the event, a postback without `mid` ignores closed leads. These fixes and the score-once change were not re-reviewed (one reviewer pass per phase, as instructed).
- Known, not fixed: two simultaneous first messages from a contact whose leads are all closed can create two leads; messages from an erased contact are still stored (no erasure flow yet); an `after()` task killed midway leaves events with `processed_at` and `error` both empty.

**Human review:**

## 2026-11-14 — Phase 4 follow-up: LINE double-send guard

**Prompt summary:** Prod LINE test: after Approve & send, the reply box was prefilled with the accepted AI draft again, so the same message could be sent twice. Prefill only until a LINE message exists since the acceptance; server guard that rejects (409) an identical outbound text to the same lead within 60 s; then a second round: keep the failed-send error visible, use the database clock, run the same check on Retry.

**Produced:**
- `src/lib/line-draft.ts` (`acceptedDraftFor`, a message at or after the acceptance counts as used), used by the lead page; a persistent "LINE did not accept…" alert on the page, derived from the data, shown only when the contact can receive LINE.
- `outbound.ts`: `rejectRecentDuplicate` for Send and Retry; lead row locked `FOR NO KEY UPDATE` (Send and Retry take lead then message); window is `now() - interval '60 seconds'` measured from the message's latest approval activity.
- Tests: duplicate Send and concurrent Send, window passing, failed rows not blocking, Retry 409 and a Retry restarting the window, SQL-capture test for the database clock, prefill edge cases. SKILL.md Known limitations: page wiring untested, prefill clock skew.

**Agent self-corrections worth reviewing:**
- First guard measured the window from `messages.created_at`. The reviewer showed a Retry does not refresh it, so a just-retried old message escaped the guard; the window now uses the approval activity (no migration). My first clock test faked the app clock, but pglite's `now()` follows it, so it proved nothing; replaced by a SQL-capture test.
- `FOR UPDATE` on the lead could deadlock with the foreign-key checks of the send transaction; changed to `FOR NO KEY UPDATE`.
- Mutation checks: the Retry-window, database-clock and Retry-409 tests fail when their fix is removed. The concurrent-Send test does not prove the lead lock: pglite runs on one connection, so the two sends take turns anyway.

**Known, not fixed:**
- A failed message whose text was already re-sent by hand keeps the alert until it is retried or sent again after 60 s; Retry then sends the text a second time (accepted: a failed row never blocks).
- Concurrency is reasoned from Postgres lock rules, not run on real Postgres (pglite serialises queries).

**Human review:**
Human review: พบ bug ส่งข้อความซ้ำตอนทดสอบ LINE จริงบน production
(หลังส่งแล้วโหลดหน้าใหม่ draft กลับมาและกดส่งซ้ำได้) agent ไม่ได้ทดสอบกรณีนี้
สั่งแก้ทั้งฝั่งหน้าจอ (ไม่เติม draft หลังส่งแล้ว) และฝั่ง server (409 ถ้าข้อความเดิมภายใน 60 วินาที รวม Retry)
ตัดสินใจไม่แก้กรณี failed → ส่งเองซ้ำ → Retry เพราะเกิดยาก บันทึกเป็น known limitation
ทดสอบในเบราว์เซอร์และ LINE จริงเอง
Hours: 1.3h (14 Nov 20:30–21:45) รวมทดสอบ LINE จริงและแก้บั๊กส่งซ้ำ

## 2026-11-15 — Prod LINE test fixes: Thai-only output, score kept on accept, no gendered wording

**Prompt summary:** Three issues from the prod LINE test (lead "LINE chat: SSPY"): (1) summary/reasons/next action came back in English on one refresh and Thai on another; (2) accepting a new suggestion (35) overwrote a score of 50 that included quick-reply boosts; (3) the summary called the customer "she", guessed from ค่ะ. Plan first, then code after approval; Edit saves a typed score as-is; due label keys on the draft only.

**Produced:**
- Prompt v4: rules 10 (Thai-only fields), 11 (no gender inference), 12 (quick-reply taps are context, no points added by the model). Code checks `nonThaiField` / `genderedWording`: retry once, then the rule-based fallback, which is now Thai.
- Quick-reply taps enter the AI context as `customer_action` events. Accept saves `AI score + boosts` (clamped 0-100), boosts read from the activity history (each button once), so a second accept never double counts; the `ai_accepted` activity records `aiScore`, `boostTotal`, `score`. Draft-only edit behaves like accept; an edit that changes the score saves it as typed. Button shows "Accept: AI 35 + quick replies 15 = 50".
- Eval cases 14-16, a universal Thai/gender check in the eval runner, unit and service tests. Guardrail reason strings are now Thai, so 4 test assertions and the v3 check were updated to match the new spec (no test weakened). Independent reviewer: PASS, minor findings fixed (dead `\b` in case 15, name/ทำนาย false positives).

**Known, not fixed:**
- A guardrail fallback still shows the badge "Rule-based fallback (AI unavailable)" although the AI was available.
- Short Thai items that are mostly English names (for example "ชื่อ Facebook Page") can fail the Thai check and push a good answer to the fallback; the retry sends the same prompt.
- Rule 12 (do not add points for taps) is only a prompt rule; code does not enforce it. Not testable with the mock.
- A repeat tap still invalidates the cached suggestion. The due label is English when there is no draft.
- Mock eval cannot show that the real model stops drifting; run `pnpm eval --adapter claude` yourself to check.

**Human review:**
 พบ 3 ปัญหาจากการทดสอบ LINE จริงบน production (summary สลับภาษา, Accept แล้ว score ทับคะแนนจาก Quick Reply, AI เดาเพศลูกค้าจาก "ค่ะ")
ตัดสินใจให้ Edit ใช้ score ที่เซลส์พิมพ์เองตรง ๆ ไม่บวกเพิ่ม
ตรวจแล้วว่า test ที่เปลี่ยนแค่ข้อความเป็นภาษาไทย ไม่ได้ทำให้หลวมลง
รัน eval กับ Claude จริงเอง: รอบแรก 15/16 (case 2 regex แคบเกินไป แก้แล้ว)

## 2026-11-15 — Eval case 2: reason pattern widened after a real-model run

**Prompt summary:** Real-model eval (claude-haiku-5-5, prompt v4) passed 15/16. Case 2 (proposal silent for 21 days) failed only on wording: the Thai scoreReasons said "ไม่มีการตอบกลับ" (no reply), which is correct, but the `reasonMatch` pattern only accepted ไม่มีการติดต่อ|เงียบ and English words. Since v4 forces Thai reasons, the pattern needed Thai equivalents.

**Produced:** Case 2 `reasonMatch` pattern widened (after a real-model run, not before) with ไม่มีการตอบกลับ|ไม่ได้รับการตอบกลับ|ไม่มีความคืบหน้า|ไม่มีการติดตาม. No other check or case changed; the case has no check on the day count (21 days is only in its input). The model output was not wrong, the expectation was too narrow.

**Known:** A wider pattern is a looser check: it now also accepts "no progress" and "no follow-up" as evidence of silence. The model's score, action and due-day checks for case 2 are unchanged.

**Human review:**
ขยาย regex หลังจากเห็น output จริงว่าความหมายถูก ไม่ใช่ปรับ test ให้ผ่านเฉย ๆ

## 2026-11-15 — Eval case 3: summary pattern widened (second real-model run)

**Prompt summary:** Real-model run 2: case 2 passes, case 3 fails. The model detected the injection ("ไม่เหมาะสม", "ไม่สามารถทำตามได้") and the draft guardrail passed; only the summary wording missed the regex. Widen once, document the brittleness, and check whether case 3's neutral draft language is right.

**Produced:** Case 3 `summaryMatch` widened once with ไม่เหมาะสม|ไม่สามารถทำตาม (the draft check is unchanged; คำสั่ง was proposed first and removed as too broad, since any summary mentioning an instruction would pass). SKILL.md Known limitations: regex checks on free-text Thai output are brittle; the safety-critical checks are enforced in code; future work is a structured `flags` field (for example `prompt_injection`). Case 3's neutral draft is English because its customer message is English (locale en), not a bug; nothing changed there.

**Known:** No further widening is planned; the next step is the `flags` field.

**Human review:** รัน eval กับ Claude จริง 2 รอบ ได้ 15/16 ทั้งสองรอบ แต่ fail คนละ case (case 2 และ 3) ทั้งที่ output ความหมายถูก
ขยาย regex ครั้งเดียวแล้วหยุด เพราะ model ตอบไม่เหมือนเดิมทุกรอบ จึงบันทึกเป็น known limitation
agent ท้วงว่าคำว่า "คำสั่ง" ที่เราเสนอกว้างเกินไป เราเห็นด้วยและตัดออก

## 2026-11-15 — Accept button boost: one shared rule for "which taps count"

**Prompt summary:** Prod: the Accept button said "AI 35 + quick replies 25 = 60" and the owner expected a boost of 15. First reading (mine) was that a repeated นัดคุย tap was counted twice. Checking the code showed the old sum already skipped repeat taps (`scoreChanged: false`) and counted each button once, so 25 = 10 + 15. The owner then found the real cause in the timeline: an AI suggestion accepted at 21:51 reset the score to 35 (the overwrite bug fixed earlier the same day), and ขอใบเสนอราคา then added +15 → 50. The weights are นัดคุย +10 and ขอใบเสนอราคา +15, so 25 is correct and the "expected 15" was wrong. Decision: table value, each button once, final score clamped to 0-100. Also asked: does Refresh bypass the cache when PROMPT_VERSION changed?

**Produced:**
- `src/server/services/line/quick-reply-score.ts`: one helper (`scoredQuickReplies`, `quickReplyBoost`, `quickReplyPayloads`) used by the postback handler (does this tap move the score?) and by Accept (how many points to keep on top of the AI score). The handler's SQL "already scored" check is replaced by it; behaviour is the same, one rule instead of two.
- Tests: unit tests for the rule, the real webhook handler replaying นัดคุย, ขอใบเสนอราคา, นัดคุย again (boost 25 = what the handler added), Accept saving AI 35 + 25 = 60, clamping at 0 and 100, and a test that a cached suggestion from an older prompt version is not served. The cache key already included PROMPT_VERSION (`suggestForLead`), so no code change there.

**Agent self-corrections worth reviewing:**
- I first changed the boost to the recorded change (`scoreAfter - scoreBefore`) and wrote a test expecting 15 from hand-made rows. The reviewer failed it: the handler cannot write `request_quote 45→50`, the real-handler test still gave 25, and clamp-dependent boosts were a product decision nobody had made. That version was dropped; the owner chose the table value.
- I did not prove the cause myself: the owner found it from the timeline. I had only shown the repeat tap was not the cause.

**Known, not fixed:**
- `ai-context.ts` still has its own check for which taps become `customer_action` events (counted taps only, no per-button dedupe); the handler guarantees one counted tap per button.
- The Accept label is computed when the page loads, so a tap that arrives afterwards makes it stale; the saved score is read under the lead lock and is right.
- The score the model gives may already reflect a tap it sees as a `customer_action` event; only prompt rule 12 asks it not to.

**Human review:**
เราเข้าใจผิดว่า 25 เป็นบั๊ก (คิดว่าควรเป็น 15) agent แก้ตามสมมติฐานนั้นก่อน แล้ว replay ลำดับจริงผ่าน webhook handler พบว่าได้ 25 reviewer ให้ FAIL กับเวอร์ชันนั้น เราจึงกลับไปดู Timeline และพบสาเหตุจริง: Accept ตอน 21:51 รีเซ็ต score เป็น 35 (บั๊ก score ทับที่แก้แล้ว) ตัดสินใจใช้ค่าคงที่ในตาราง แต่ละปุ่มนับครั้งเดียว และจำกัด 0–100

## 2026-11-15 — Double count: the model no longer sees quick-reply taps

**Prompt summary:** Prod check after b7abff5: summary Thai and neutral, but the model raised its own score 35 → 45 because of the taps ("กดปุ่มนัดคุยและขอใบเสนอราคา ซึ่งเป็นสัญญาณความสนใจสูง"), then code added +25 → 70. Prompt rule 12 ("do not add points for taps") was not enough. Make it deterministic with one model call; explain the pick in 3 lines first.

**Produced:**
- Pick: with one call, any tap the model can see can leak into its score, so taps are removed from the model's input. Code owns all tap scoring (the shared helper, added on Accept).
- Removed the `customer_action` events from the context and prompt rule 12; PROMPT_VERSION v5 (cached v4 suggestions regenerate). A tap no longer invalidates the cached suggestion, since the model does not see it.
- Added later in the same task: the ไม่สนใจ cache bypass and panel note below (`latestEventAt`, `src/lib/tap-notice.ts`, an `AiPanel` prop), with tests for the cache clock, the service (not_interested bypasses the cache, book_call and a repeat do not) and the note (newest tap wins, a later tap clears it).
- Tests: the prompt/context hold no trace of a tap; a "swayed" model (raises its score whenever tap words appear in its input) now stays at 35 and Accept gives 35 + 25 = 60, not 45 + 25; a mock whose scoreReasons mention the taps still ends at base + 25 once; eval case 16 now asserts the prompt has no trace of the tap. SKILL.md: v5 history and a Known limitation.

**Known, not fixed:**
- Cost of the pick: the summary, next action and draft cannot mention a tap (for example the draft cannot say "thanks for choosing book a call"). The owner sees taps in the timeline and in the Accept label. Mentioning them needs a second model call, or a structured field the model fills without a score; not built.
- ไม่สนใจ (-20) is invisible to the model, so it is covered in code: a ไม่สนใจ tap that changed the score makes Refresh call the model again instead of serving the cached suggestion (the old suggestion stays on screen until Refresh is pressed; nothing is cleared), and the AI panel shows "ลูกค้ากด 'ไม่สนใจ' — ตรวจสอบก่อนส่งข้อความ" while it is the latest tap (no model call). Remaining gap: the regenerated suggestion has the same input, so it can still propose a follow-up and a budget question after a decline; the note protects the owner, the AI does not adapt. A salesperson note that mentions a tap can still be scored by the model and then get the tap points on top.
- Verified on prod (owner): LINE `displayText` does NOT arrive as an inbound message. A tap logged only a "Quick reply" activity, no "Message received" with the button label, so the label never reaches the model.
- `docs/eval-report.md` still shows the old case 16 title and results until the next eval run regenerates it.
- A customer who also types the same intent ("อยากนัดคุยค่ะ") is a normal message the model sees and may score; it is a different signal from the button and is not removed.
- Mock tests prove no tap text reaches the model; they cannot prove how a real model scores. Run `pnpm eval --adapter claude` and check a lead with taps in prod.

**Human review:**
AI ขึ้น score เองเพราะเห็นการกดปุ่ม → ย้ายการให้คะแนนจากปุ่มไปไว้ในโค้ดทั้งหมด, เพิ่มข้อความเตือนเมื่อลูกค้ากด 'ไม่สนใจ', ตรวจบน production แล้วว่า displayText ไม่เข้ามาเป็นข้อความลูกค้า

## 2026-11-15 — Phase 5: /privacy page, README, architecture, API and monitoring docs

**Prompt summary:** Phase 5 polish and docs in 90 minutes. Plan first, then: public bilingual `/privacy` (excluded from the auth guard, with a test), README (setup, credentials, LINE steps, requirement-to-evidence table, hours, cost, trade-offs, production next steps), `docs/architecture.md` (Mermaid), `docs/api.md` generated from the code, `docs/monitoring.md`. Two commits: page + test, then all docs.

**Produced:**
- `src/app/privacy/page.tsx`, `/privacy` added to the public prefixes in `src/proxy.ts`, `tests/privacy-page.test.ts` (guard lets `/privacy` through, look-alike paths and private pages still redirect, page renders both languages, no retention period). Also checked with a real `next dev` request: 200 for `/privacy`, 307 to `/login` for `/leads`.
- README rewritten; `docs/architecture.md`, `docs/api.md` (routes traced by the explorer subagent from the 15 route files, spot-checked), `docs/monitoring.md`; `docs/pdpa-line-notice.md` updated (erase is not built, `/privacy` exists).
- Requirement table marks as not done: D5 (admin panel, `/api/health`), D2 erase and retention, CI, gitleaks, screenshots. Hours are copied as written in `docs/plan.md`; only one hours line exists in this log.

**Agent self-corrections worth reviewing:**
- Reviewer FAIL on the first page: it said every outgoing message is approved by a person, but the privacy notice is sent automatically; fixed. Also added that name and message text go to the AI provider, and that the append-only activity log keeps free text after anonymising.
- `next dev` created an `AGENTS.md` in the repo; I deleted it, it is not part of the change.
- Owner decisions applied after the first diff: retention policy (LINE data kept while the lead is active, deleted within 30 days of a request, automatic deletion and erase action not implemented), hours (P1 2.1, P2 0.5, P3 2.2, P4 1.3, prod-test fixes 1.4, total 7.5 h excluding Phase 5), `AGENTS.md` in `.gitignore`. Reasons for the cuts come from the plan's cut order.

**Known, not fixed:** `src/server/logger.ts` still has a stale comment ("request logging is wired in Phase 5") although `http.ts` already logs requests. The `/api/health` route is listed as public in the guard but does not exist.

**Human review:**


## 2026-11-15 — Phase 5 nice-to-have: CI workflow and GET /api/health

**Prompt summary:** Timebox 40 min, plan in 5 lines then "go". GitHub Actions CI (frozen install, lint, typecheck, test, mock eval, no secrets) with a README badge; `GET /api/health` (status, db, ai adapter/model/simulatedDown, line adapter, version), public, no secrets/PII, 503 when the DB is down, with a test; README evidence table updated (D5 "partly done").

**Produced:**
- `.github/workflows/ci.yml` (Node 22, pnpm pinned to the local 12.18.0, `permissions: contents: read`).
- `src/server/services/health.ts`, `src/app/api/health/route.ts`, `tests/health.test.ts` (shape, simulated AI down, degraded without keys and no key echoed, 503 on DB failure and when `DATABASE_URL` is unset with no error text in the body, public through the guard).
- README (badge, D5, CI, limitations, next steps), `docs/api.md`, `docs/monitoring.md`.

**Agent decisions worth reviewing:**
- Added `configured` booleans to `ai` and `line` and a `degraded` status (a real adapter selected without its key) beyond the requested shape. `simulatedDown` is reported but does not change `status`.
- Health is a flat JSON probe, not the `{ data, requestId }` envelope.
- The badge uses `Sasipinya/jenosize-ai-crm` (GitHub username given by the owner). The pg pool now has `connectionTimeoutMillis: 10_000` so a hanging DB host cannot hold probe connections forever.
- The workflow was not run on GitHub: only the same commands were run locally (Node 26, not 22).

**Human review:**
