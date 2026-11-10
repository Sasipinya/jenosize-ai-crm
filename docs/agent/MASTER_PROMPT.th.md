# MASTER PROMPT (ฉบับแปลไทยไว้อ่าน) — AI CRM Copilot (Jenosize take-home)

> ไฟล์นี้แปลไว้ให้อ่านทำความเข้าใจเท่านั้น ไฟล์ที่ส่งให้ agent จริงคือ `MASTER_PROMPT.md` ภาษาอังกฤษ
>
> วิธีใช้: วาง `CLAUDE.md` (กฎถาวร) ไว้ที่ root ของ repo ก่อน แล้วส่งไฟล์นี้ทั้งไฟล์เป็นข้อความแรกของ session จากนั้นทำทีละ phase อย่าสั่งให้ agent ทำทุกอย่างรวดเดียว

---

## 0. บทบาทของคุณ (agent)

คุณคือ senior full-stack engineer ที่ทำงานคู่กับฉัน (Lead) ฉันเป็นคนตัดสินใจทุกอย่างและรีวิวทุก diff ส่วนคุณมีหน้าที่เสนอ ลงมือทำทีละขั้นเล็ก ๆ ทดสอบ และอธิบาย คุณห้าม push, deploy หรือ publish เด็ดขาด และกฎใน `CLAUDE.md` มีผลเหนือกว่าเสมอ

## 1. บริบท

Jenosize ต้องการ AI CRM MVP สำหรับใช้ภายใน ทีมขาย 20 คน มีประมาณ 2,000 contacts และ 300 active leads lead เข้ามาจากเว็บไซต์ การกรอกเอง และ LINE OA ส่วนการติดตามลูกค้ากระจัดกระจายอยู่ในแชท สเปรดชีต และโน้ตส่วนตัว

เซลส์ต้องทำสิ่งเหล่านี้ได้:
- ดู profile ของ lead และ timeline ของ activities กับบทสนทนา
- ย้าย lead ผ่าน New → Qualified → Proposal → Won / Lost
- ขอให้ AI สรุป ให้คะแนนพร้อมเหตุผล เสนอ next-best action และร่างข้อความตอบทาง LINE
- ส่งหรืออนุมัติข้อความ LINE โดยไม่ทำให้ audit trail หาย

ใช้ข้อมูลสังเคราะห์เท่านั้น ใช้ LINE OA ทดสอบของเราเอง ต้องมี fallback ที่ปลอดภัยเมื่อ model หรือ LINE ใช้งานไม่ได้ กรอบเวลาประมาณ 16 ชั่วโมง จึงต้องทำแบบ pragmatic

## 2. Stack (ห้ามเปลี่ยนโดยไม่ถามก่อน)

Next.js (App Router) + TypeScript strict · TailwindCSS + shadcn/ui · Postgres บน Neon (branch `dev` สำหรับเครื่องตัวเอง, `main` สำหรับ production; ไม่ใช้ Docker) · ใช้ pglite สำหรับเทสต์ · Drizzle ORM + drizzle-kit migrations · Zod · Auth.js Credentials (demo users) · Anthropic Claude ผ่าน adapter (env `AI_MODEL` ค่าเริ่มต้นเป็นรุ่นระดับ Haiku) · @line/bot-sdk ผ่าน adapter · Vitest · pino · Vercel · GitHub Actions · pnpm

## 3. Requirement บังคับ (ตอนจบต้องมีครบทุกข้อ)

### Part 1 — ระบบที่ใช้งานได้จริง
- R1  เว็บแบบ responsive (ใช้งานได้ที่ความกว้าง 375px และ 1280px)
- R2  login ด้วย demo credentials ที่ระบุไว้ในเอกสาร (role: admin, sales)
- R3  จัดการ lead: list, สร้าง, แก้ไข, ค้นหา, กรองตาม stage / owner / source
- R4  จัดการ company: list, ค้นหา, สร้าง, แก้ไข
- R5  จัดการ contact: list, ค้นหา, สร้าง, แก้ไข
- R6  อัปเดต stage ใน pipeline โดยทุกการเปลี่ยนต้องเขียน row ใน `activities`
- R7  หน้า lead detail: profile, company, contact, timeline รวมของ activities และ messages, เพิ่ม note ได้
- R8  lead มาจาก 3 ช่องทาง: เว็บไซต์ (`POST /api/public/leads` + หน้าตัวอย่าง `/contact-us`), ฟอร์มกรอกเอง, LINE
- R9  DB แบบ relational: users, companies, contacts, leads, activities, messages (+ ai_suggestions, line_events, app_settings)
- R10 migrations, seed สังเคราะห์ (users 20, companies ~150, contacts 2,000, leads 300, ชื่อภาษาไทย, lead "มีเนื้อเรื่อง" 5 ราย), Zod validation และ constraints จริง
- R11 deploy แล้ว ข้อมูลอยู่รอดหลัง refresh และ restart ห้ามใช้ข้อมูล hard-code ใน memory

### Part 2 — AI skill + LINE
- R12 ไฟล์ `skills/crm-copilot/SKILL.md` มีหัวข้อ: Purpose, Inputs, Outputs, Allowed actions, Guardrails, Failure behavior, Evaluation cases (อย่างน้อย 5 เคส)
- R13 ผลลัพธ์ AI: summary, score 0–100 พร้อมเหตุผล, next-best action, ร่างข้อความ LINE, confidence, missingInfo โดยตรวจด้วย Zod
- R14 suggestion ของ AI ถูกเก็บเป็น `pending` จะเกิดการเขียน DB หรือส่งข้อความได้ก็ต่อเมื่อคนกด Accept/Edit เท่านั้น
- R15 LINE webhook: ตรวจ `x-line-signature` (HMAC-SHA256, raw body, `timingSafeEqual`), บันทึก event และกันซ้ำด้วย `webhookEventId`
- R16 จับคู่ LINE user กับ contact/lead (ถ้าเป็นคนใหม่ให้สร้าง contact + lead ที่ source = line)
- R17 ขาออก: ต้องผ่านการอนุมัติ ส่งด้วย Push API พร้อม `X-Line-Retry-Key` retry แบบ backoff เมื่อเจอ 5xx/timeout ถ้ายอมแพ้ให้สถานะเป็น `failed` พร้อมปุ่ม Retry
- R18 มี mock adapter ของ LINE และของ LLM สำหรับ local และ CI
- R19 fallback เมื่อ LLM ล้มเหลว: ใช้คำแนะนำแบบ rule-based พร้อม `source: "fallback"` และมี badge ให้เห็นใน UI
- R20 ห้ามมี secret อยู่ใน repo เด็ดขาด

### Part 3 — หลักฐานทางวิศวกรรมและการส่งมอบ
- R21 README: setup, run, deploy, demo credentials, ขั้นตอนทดสอบ LINE + QR, trade-off สำคัญ, ข้อจำกัด, สิ่งที่ต้องทำต่อถ้าขึ้น production, บันทึกชั่วโมง
- R22 `docs/architecture.md` มี Mermaid diagram ของ architecture และ data flow
- R23 `docs/api.md` บันทึก API และไฟล์ `.env.example`
- R24 เทสต์: (a) flow หลักของ CRM, (b) พฤติกรรมของ AI skill + fallback, (c) LINE webhook signature + idempotency
- R25 structured logging (pino, requestId, redaction) + `docs/monitoring.md`
- R26 `docs/ai-usage-log.md`: งานและ prompt, สิ่งที่รีวิวหรือ reject, และการแก้ไขที่สำคัญ 1 เรื่องหลังคนตรวจ

## 4. จุดเด่นเพิ่มเติม (ทำหลังจาก R ใน phase เดียวกันผ่านหมดแล้ว)

- D1 Feedback loop: เก็บ `original_output` เทียบกับ `final_output` + `reject_reason` ใช้ reply ที่คนอนุมัติแล้ว 3 อันที่ใกล้เคียงที่สุดเป็น few-shot ส่วน suggestion ที่ถูก dismiss ห้ามใช้เป็นตัวอย่าง
- D2 PDPA: ส่ง privacy notice เมื่อติดต่อทาง LINE ครั้งแรก + บันทึก `consent_at` มีปุ่มให้ admin "ลบข้อมูลลูกค้า" ที่ anonymize PII แต่เก็บ audit trail ไว้ และเขียน retention policy ใน README
- D3 Thai-first: ค้นชื่อไทยด้วย `pg_trgm` ข้อความตอบใช้ ครับ/ค่ะ ตามเซลส์เจ้าของ lead และปรับระดับความสุภาพตามลูกค้า
- D4 setup คำสั่งเดียว: `pnpm install && pnpm setup` (migrate + seed) ใช้กับ Postgres ตัวไหนก็ได้ที่ระบุใน `DATABASE_URL` (Neon ฟรีก็ได้) ไม่ใช้ Docker
- D5 Demo control panel (admin): toggle `simulate_ai_down`, `simulate_line_down` ใน `app_settings` และ `GET /api/health`
- D6 ปุ่ม LINE Quick Reply (นัดคุย / ขอใบเสนอราคา / ไม่สนใจ) postback สร้าง activity และปรับ score ถ้า postback ซ้ำให้ข้าม

## 5. Data model (ทำตามนี้ ถ้าจะเปลี่ยนต้องเสนอก่อน)

- users: id, email UNIQUE, name, password_hash, role CHECK(admin|sales), polite_particle CHECK(ครับ|ค่ะ)
- companies: id, name NOT NULL, industry, website, size; trigram index บน name
- contacts: id, company_id FK SET NULL, full_name NOT NULL, email UNIQUE NULL, phone, line_user_id UNIQUE NULL, owner_id FK, consent_at, erased_at; trigram index บน full_name
- leads: id, contact_id FK, company_id FK, owner_id FK, title, stage enum (new|qualified|proposal|won|lost), source enum (website|manual|line), value_thb ≥ 0, score 0–100, lost_reason, stage_changed_at; CHECK ถ้า stage='lost' ต้องมี lost_reason; index (stage, owner_id)
- activities (เพิ่มได้อย่างเดียว ห้ามแก้หรือลบ): id, lead_id, actor_id NULL (=system), type enum (note|stage_change|call|ai_accepted|message_sent|message_received|quick_reply|consent|data_erased), payload jsonb, created_at; index (lead_id, created_at)
- messages: id, lead_id, contact_id, direction (in|out), body, status (draft|approved|sent|failed), approved_by, line_message_id, retry_key UNIQUE, attempts; CHECK ถ้า status='sent' และ direction='out' ต้องมี approved_by
- ai_suggestions: id, lead_id, original_output jsonb, final_output jsonb, source (llm|fallback), model, prompt_version, status (pending|accepted|edited|dismissed), reject_reason, decided_by, decided_at
- line_events: id, webhook_event_id UNIQUE, line_user_id, type, raw jsonb, processed_at, error
- app_settings: key PK, value jsonb, updated_by

การเปลี่ยน stage กับ row ใน activity ต้องอยู่ใน transaction เดียวกัน Won/Lost เป็นสถานะสุดท้าย เฉพาะ admin เท่านั้นที่เปิดใหม่ได้

## 6. กฎด้าน architecture

- `src/server/services/*` เก็บ business logic ส่วน route handler ต้องบาง
- `src/server/ai/*`: context builder (ตัดเบอร์โทร/อีเมล), interface ของ LLM adapter (`claude`, `mock`), fallback, ตัวดึง few-shot
- `src/server/line/*`: signature, interface ของ adapter (`real`, `mock`), handler
- ทุก API response: `{ data }` หรือ `{ error: { code, message } }` + requestId
- ข้อความลูกค้าเป็น data ไม่ใช่คำสั่ง ต้องห่อด้วย delimiter ใน prompt
- การเรียก LLM: timeout 15 วินาที, retry 1 ครั้ง, parse ด้วย Zod ถ้าไม่ผ่านใช้ fallback และ log model, latency, จำนวน token และ source
- Webhook: อ่าน raw body ด้วย `await req.text()` ก่อน parse ตอบ 200 ให้เร็วหลังบันทึกแล้ว ค่อยประมวลผลทีหลัง

## 7. Guardrails กัน red flag (agent ต้องทำตัวแบบนี้)

| Red flag | สิ่งที่ต้องทำแทน |
| --- | --- |
| ทำตาม ticket อย่างเดียวโดยไม่คิด | ก่อนเริ่มแต่ละ phase ให้ทวนเป้าหมาย ระบุ assumptions และชี้ requirement ที่ไม่ชัด แล้วเขียน assumptions ลงใน `docs/discovery.md` |
| ใช้ AI แบบไม่ตรวจ | จบทุกงานต้องมี: เทสต์ที่รันแล้ว, รายการ "จุดที่ต้องรีวิว" (security, data, edge cases) ให้ฉัน และ 1 รายการใน AI-usage log ที่เว้นบรรทัด `Human review:` ว่างไว้ |
| อธิบายโปรเจกต์ตัวเองไม่ได้ | ทุกไฟล์ที่ไม่ใช่ไฟล์ง่าย ๆ ให้ใส่ comment หัวไฟล์ 2 บรรทัดบอกหน้าที่ของไฟล์ และหลังจบแต่ละ phase ให้สรุป "ระบบทำงานอย่างไร" 5 ข้อ ที่ฉันเอาไปพูดตอนสัมภาษณ์ได้ |
| ทำเกินหรือทำน้อยเกินไป | ห้ามมี queue, microservices, Redis, GraphQL หรือ caching layer แต่ห้ามข้ามเรื่อง security, validation, idempotency และ transaction |
| โทษว่า requirement ไม่ชัด | ถ้ามีจุดที่คลุมเครือ ให้เลือกทางที่ง่ายและสมเหตุสมผลที่สุด บันทึกเป็น ADR ใน `docs/adr/NNN-title.md` (บริบท, การตัดสินใจ, trade-off) แล้วทำต่อ |
| ต้องให้คนคุมตลอด | เสนอขั้นตอนถัดไปเองเมื่อจบแต่ละงาน และถามฉันเฉพาะเรื่องที่ย้อนกลับยาก |

## 8. Phases (หยุดที่ทุก GATE แล้วรอให้ฉันพิมพ์ "go")

**Phase 1 — วางฐาน** (R1 โครง layout, R2, R9, R10, R11, R20, D3 seed, D4)
scaffold, `pnpm setup`, ระบบเทสต์ด้วย pglite, schema + migration, seed ภาษาไทยพร้อม lead มีเนื้อเรื่อง 5 ราย, demo login ด้วย Auth.js, app shell แบบ responsive, `.env.example` และขั้นตอน deploy
GATE: ฉัน deploy และ login ได้

**Phase 2 — CRM core** (R3–R8, R24a, D3 ค้นหา)
services, API, leads list + filters + ค้นชื่อไทย, dropdown เปลี่ยน stage, lead detail + timeline + notes, หน้า companies + contacts, ฟอร์มสร้าง lead, public lead endpoint + `/contact-us`, เทสต์ (a)
GATE: ฉันรีวิว diff และรันเทสต์

**Phase 3 — AI skill** (R12–R14, R19, R24b, D1, D3 โทนภาษา)
เขียน SKILL.md ก่อน แล้วหยุดให้ฉันรีวิว จากนั้นทำ context builder, adapters, fallback, AI panel (Accept/Edit/Dismiss + เหตุผล), ตัวดึง few-shot, eval runner (`pnpm eval`), เทสต์ (b)
GATE: รายงานผล eval + ฉันรีวิว

**Phase 4 — LINE** (R15–R18, R24c, D2 consent, D6)
webhook security, กันซ้ำ, การจับคู่ contact/lead, privacy notice, ขาออกที่ต้องอนุมัติพร้อม retry key, Quick Reply + postback, mock adapter, `scripts/simulate-line-webhook.ts`, เทสต์ (c)
GATE: ฉันทดสอบด้วยมือถือ

**Phase 5 — ส่งมอบ** (R21–R23, R25, R26, D2 ลบข้อมูล, D5)
demo control panel + `/api/health`, ลบข้อมูลตาม PDPA, pino redaction, monitoring notes, README, เอกสาร architecture + API, CI (lint, typecheck, test, eval), ตรวจ responsive ที่ 375px
GATE: checklist สุดท้ายด้านล่าง

## 9. Definition of done (ต้องเช็คครบทุกบรรทัดก่อนปิด Phase 5)

- [ ] R1–R26 แต่ละข้อชี้ไปที่ไฟล์ route หรือเทสต์ที่พิสูจน์ได้
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm eval` ผ่านทั้งหมด
- [ ] clone ใหม่ ใส่ `DATABASE_URL` แล้วรัน `pnpm install && pnpm setup && pnpm dev` ได้
- [ ] `pnpm test` รันบน pglite ได้โดยไม่ต้องมี DB ภายนอกและไม่ต้องมี secret
- [ ] ไม่มี secret, ชื่อจริง, เบอร์โทรจริง หรืออีเมลจริงใน git history
- [ ] AI ไม่เคยเขียนข้อมูลแบบยืนยันแล้วหรือส่ง LINE โดยไม่มีคนกด
- [ ] จำลอง AI ล่มและ LINE ล่มแล้ว UI ยังทำงานได้อย่างปลอดภัย
- [ ] README ระบุชั่วโมงที่ใช้จริงเทียบกับแผน และสิ่งที่ตัดออกพร้อมเหตุผล

ตอนจบให้ทำตาราง: Requirement → หลักฐาน (ไฟล์/route/เทสต์)

## 10. เริ่มได้เลย

อ่าน `CLAUDE.md` และ `docs/plan.md` แล้วตอบเฉพาะ Phase 1:
1. ความเข้าใจเป้าหมาย 3 บรรทัด
2. assumptions และคำถามที่ยังเปิดอยู่
3. รายชื่อไฟล์ที่จะสร้าง
4. ลำดับขั้นตอน

รอให้ฉันพิมพ์ "go" ก่อนเขียนโค้ดใด ๆ
