// Test (a): core CRM flow on pglite. Create → stage change writes activity in the same transaction,
// lost needs a reason (400), terminal stages need admin, Thai search, website intake + honeypot.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leadCreateSchema, leadUpdateSchema, stageChangeSchema, websiteLeadSchema } from "@/lib/validation/crm";
import { activities, contacts, leads, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { createCompany } from "@/server/services/companies";
import { createContact, listContacts, updateContact } from "@/server/services/contacts";
import { addNote, changeStage, createLead, createWebsiteLead, getLeadDetail, listLeads } from "@/server/services/leads";
import { createTestDb, type TestDb } from "./helpers/test-db";

let t: TestDb;
let sales: { id: string; role: "sales" };
let admin: { id: string; role: "admin" };
let contactId: string;

beforeAll(async () => {
  t = await createTestDb();
  const [s, a] = await t.db
    .insert(users)
    .values([
      { email: "s@example.com", name: "Sales", passwordHash: "x", role: "sales", politeParticle: "ค่ะ" },
      { email: "a@example.com", name: "Admin", passwordHash: "x", role: "admin", politeParticle: "ครับ" },
    ])
    .returning();
  sales = { id: s!.id, role: "sales" };
  admin = { id: a!.id, role: "admin" };
  const company = await createCompany(t.db, { name: "บริษัท สยามดิจิทัล จำกัด", industry: null, website: null, size: null });
  contactId = (await createContact(t.db, { fullName: "สมชาย ใจดี", email: "somchai@example.com", phone: null, companyId: company.id, ownerId: null })).id;
});

afterAll(async () => {
  await t.close();
});

const actsOf = (leadId: string) => t.db.select().from(activities).where(eq(activities.leadId, leadId));
const expectCode = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
};

describe("CRM flow", () => {
  it("creates a lead, moves it to qualified and records a stage_change activity", async () => {
    const lead = await createLead(t.db, sales, leadCreateSchema.parse({ title: "ระบบ CRM ให้ร้านค้า", contactId, valueThb: "50000" }));
    expect(lead).toMatchObject({ stage: "new", source: "manual", ownerId: sales.id, valueThb: 50000 });

    const moved = await changeStage(t.db, sales, lead.id, stageChangeSchema.parse({ stage: "qualified" }));
    expect(moved.stage).toBe("qualified");

    const change = (await actsOf(lead.id)).filter((a) => a.type === "stage_change");
    expect(change).toHaveLength(1);
    expect(change[0]).toMatchObject({ actorId: sales.id, payload: { from: "new", to: "qualified" } });
  });

  it("rejects lost without a reason (400) and leaves stage and activities untouched", async () => {
    const lead = await createLead(t.db, sales, leadCreateSchema.parse({ title: "ลีดทดสอบ lost", contactId }));
    const before = (await actsOf(lead.id)).length;

    await expectCode(changeStage(t.db, sales, lead.id, stageChangeSchema.parse({ stage: "lost" })), "VALIDATION_ERROR");
    await expectCode(changeStage(t.db, sales, lead.id, stageChangeSchema.parse({ stage: "lost", lostReason: "   " })), "VALIDATION_ERROR");

    const [row] = await t.db.select().from(leads).where(eq(leads.id, lead.id));
    expect(row!.stage).toBe("new");
    expect((await actsOf(lead.id)).length).toBe(before);

    const lost = await changeStage(t.db, sales, lead.id, stageChangeSchema.parse({ stage: "lost", lostReason: "งบไม่พอ" }));
    expect(lost).toMatchObject({ stage: "lost", lostReason: "งบไม่พอ" });
  });

  it("treats won/lost as terminal: sales is refused, admin can reopen and the reason is cleared", async () => {
    const lead = await createLead(t.db, sales, leadCreateSchema.parse({ title: "ลีด terminal", contactId }));
    await changeStage(t.db, sales, lead.id, { stage: "lost", lostReason: "เงียบหาย" });

    await expectCode(changeStage(t.db, sales, lead.id, { stage: "new", lostReason: null }), "FORBIDDEN");
    const reopened = await changeStage(t.db, admin, lead.id, { stage: "new", lostReason: null });
    expect(reopened).toMatchObject({ stage: "new", lostReason: null });
    await expectCode(changeStage(t.db, admin, lead.id, { stage: "new", lostReason: null }), "VALIDATION_ERROR");
  });

  it("finds a just-created lead by Thai title, contact name and company name", async () => {
    const lead = await createLead(t.db, sales, leadCreateSchema.parse({ title: "โครงการระบบบัญชีคลาวด์", contactId }));
    for (const q of ["บัญชีคลาวด์", "สมชาย", "สยามดิจิทัล"]) {
      const res = await listLeads(t.db, { q, page: 1 });
      expect(res.items.map((l) => l.id), `query ${q}`).toContain(lead.id);
    }
    expect((await listLeads(t.db, { q: "ไม่มีคำนี้แน่นอน", page: 1 })).total).toBe(0);
    expect((await listContacts(t.db, { q: "ใจดี", page: 1 })).items.map((c) => c.id)).toContain(contactId);
  });

  it("treats % and _ in search text literally", async () => {
    expect((await listLeads(t.db, { q: "%", page: 1 })).total).toBe(0);
  });

  it("filters by stage and source", async () => {
    const lost = await listLeads(t.db, { q: "", page: 1, stage: "lost" });
    expect(lost.items.length).toBeGreaterThan(0);
    expect(lost.items.every((l) => l.stage === "lost")).toBe(true);
    expect((await listLeads(t.db, { q: "", page: 1, source: "line" })).total).toBe(0);
  });

  it("adds a note to the timeline, newest first, with actor name", async () => {
    const lead = await createLead(t.db, sales, leadCreateSchema.parse({ title: "ลีด note", contactId }));
    await addNote(t.db, sales, lead.id, { type: "note", text: "โทรคุยแล้ว สนใจ" });
    const detail = await getLeadDetail(t.db, lead.id);
    const first = detail.timeline[0]!;
    expect(first).toMatchObject({ kind: "activity", type: "note", actorName: "Sales", payload: { text: "โทรคุยแล้ว สนใจ" } });
    await expectCode(getLeadDetail(t.db, "00000000-0000-4000-8000-0000000000ff"), "NOT_FOUND");
  });

  it("returns CONFLICT for a duplicate contact email", async () => {
    await expectCode(
      createContact(t.db, { fullName: "คนอื่น", email: "somchai@example.com", phone: null, companyId: null, ownerId: null }),
      "CONFLICT",
    );
  });
});

describe("review regressions", () => {
  it("refuses to edit an erased contact", async () => {
    const c = await createContact(t.db, { fullName: "ลบแล้ว", email: null, phone: null, companyId: null, ownerId: null });
    await t.db.update(contacts).set({ erasedAt: new Date() }).where(eq(contacts.id, c.id));
    await expectCode(updateContact(t.db, c.id, { fullName: "ลบแล้ว", email: "back@example.com", phone: "0800000000", companyId: null, ownerId: null }), "CONFLICT");
  });

  it("maps a nonexistent company FK to a Postgres 23503 the HTTP layer turns into 400", async () => {
    const err = await createContact(t.db, { fullName: "FK", email: null, phone: null, companyId: "00000000-0000-4000-8000-0000000000aa", ownerId: null }).then(() => null, (e: unknown) => e);
    const { pgCode } = await import("@/server/services/common");
    expect(pgCode(err)).toBe("23503");
  });

  it("rejects a blank value on lead edit instead of saving 0, and defaults blank on create", () => {
    expect(leadUpdateSchema.safeParse({ valueThb: "" }).success).toBe(false);
    expect(leadCreateSchema.parse({ title: "x", contactId: "00000000-0000-4000-8000-000000000001", valueThb: "" }).valueThb).toBe(0);
  });

  it("two simultaneous website submissions with a new email both succeed", async () => {
    const f = websiteLeadSchema.parse({ fullName: "แข่งกัน", email: "race@example.com", message: "hi" });
    const [a, b] = await Promise.all([createWebsiteLead(t.db, f), createWebsiteLead(t.db, f)]);
    expect(a.leadId).toBeDefined();
    expect(b.leadId).toBeDefined();
  });
});

describe("website intake", () => {
  const form = { fullName: "วิภา รักงาน", email: "Wipa@Example.com", message: "สนใจระบบ CRM ค่ะ", companyName: "ร้านวิภา" };

  it("creates a contact and a source=website lead with the message as the first activity", async () => {
    const res = await createWebsiteLead(t.db, websiteLeadSchema.parse(form));
    expect(res.leadId).toBeDefined();
    const detail = await getLeadDetail(t.db, res.leadId!);
    expect(detail.lead).toMatchObject({ source: "website", stage: "new", ownerId: null });
    expect(detail.contact.email).toBe("wipa@example.com");
    expect(detail.timeline[0]).toMatchObject({ type: "note", actorName: null, payload: { text: "สนใจระบบ CRM ค่ะ" } });
  });

  it("reuses the existing contact when the email is already known", async () => {
    const before = (await listContacts(t.db, { q: "wipa@", page: 1 })).total;
    await createWebsiteLead(t.db, websiteLeadSchema.parse(form));
    expect((await listContacts(t.db, { q: "wipa@", page: 1 })).total).toBe(before);
  });

  it("silently drops honeypot submissions without writing anything", async () => {
    const before = (await listLeads(t.db, { q: "", page: 1 })).total;
    const res = await createWebsiteLead(t.db, websiteLeadSchema.parse({ ...form, email: "bot@example.com", companyWebsite: "http://spam.example" }));
    expect(res).toEqual({ accepted: true });
    expect((await listLeads(t.db, { q: "", page: 1 })).total).toBe(before);
  });

  it("validates the payload (bad email, empty message)", () => {
    expect(websiteLeadSchema.safeParse({ ...form, email: "nope" }).success).toBe(false);
    expect(websiteLeadSchema.safeParse({ ...form, message: " " }).success).toBe(false);
  });

  it("rate limiter allows the limit then blocks, and resets after the window", () => {
    const k = "test-key";
    const allowed = [1, 2, 3].map(() => rateLimit(k, 2, 1000, 0));
    expect(allowed).toEqual([true, true, false]);
    expect(rateLimit(k, 2, 1000, 1001)).toBe(true);
  });
});
