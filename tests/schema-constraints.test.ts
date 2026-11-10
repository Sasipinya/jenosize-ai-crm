// Proves the DB itself enforces the data rules (not just app code): CHECKs, UNIQUEs,
// the append-only activities trigger, and trigram search on Thai names.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, companies, contacts, leads, messages, users } from "@/server/db/schema";
import { createTestDb, type TestDb } from "./helpers/test-db";

let t: TestDb;
let userId: string;
let contactId: string;
let leadId: string;

/** Drizzle wraps driver errors; the Postgres message lives on `cause`. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return `${err.message ?? ""} ${err.cause?.message ?? ""}`;
  }
  throw new Error("expected the statement to fail");
}

beforeAll(async () => {
  t = await createTestDb();
  const [u] = await t.db
    .insert(users)
    .values({ email: "owner@example.com", name: "ทดสอบ เจ้าของ", passwordHash: "x", politeParticle: "ค่ะ" })
    .returning();
  userId = u!.id;
  const [c] = await t.db.insert(contacts).values({ fullName: "สมชาย ใจดี", email: "somchai@example.com" }).returning();
  contactId = c!.id;
  const [l] = await t.db
    .insert(leads)
    .values({ contactId, ownerId: userId, title: "ระบบ POS", source: "manual" })
    .returning();
  leadId = l!.id;
});

afterAll(async () => {
  await t.close();
});

describe("leads", () => {
  it("rejects stage=lost without a lost_reason", async () => {
    const msg = await pgError(t.db.update(leads).set({ stage: "lost" }).where(eq(leads.id, leadId)));
    expect(msg).toContain("leads_lost_reason_check");
  });

  it("rejects stage=lost with a blank lost_reason", async () => {
    const msg = await pgError(
      t.db.update(leads).set({ stage: "lost", lostReason: "   " }).where(eq(leads.id, leadId)),
    );
    expect(msg).toContain("leads_lost_reason_check");
  });

  it("accepts stage=lost with a reason", async () => {
    const [l] = await t.db
      .insert(leads)
      .values({ contactId, title: "lost one", source: "line", stage: "lost", lostReason: "งบไม่พอ" })
      .returning();
    expect(l!.stage).toBe("lost");
  });

  it("rejects negative value_thb and score outside 0-100", async () => {
    expect(await pgError(t.db.insert(leads).values({ contactId, title: "x", source: "manual", valueThb: -1 }))).toContain(
      "leads_value_thb_check",
    );
    expect(await pgError(t.db.insert(leads).values({ contactId, title: "x", source: "manual", score: 101 }))).toContain(
      "leads_score_check",
    );
  });
});

describe("users and contacts", () => {
  it("rejects a duplicate contact email but allows many NULL emails", async () => {
    expect(await pgError(t.db.insert(contacts).values({ fullName: "ซ้ำ", email: "somchai@example.com" }))).toContain(
      "contacts_email_unique",
    );
    await t.db.insert(contacts).values([{ fullName: "ไม่มีอีเมล หนึ่ง" }, { fullName: "ไม่มีอีเมล สอง" }]);
  });

  it("rejects an unknown role and polite particle", async () => {
    const base = { name: "x", passwordHash: "x" };
    expect(
      await pgError(
        t.db.insert(users).values({ ...base, email: "r@example.com", politeParticle: "ค่ะ", role: "root" as "admin" }),
      ),
    ).toContain("users_role_check");
    expect(
      await pgError(t.db.insert(users).values({ ...base, email: "p@example.com", politeParticle: "จ้า" as "ค่ะ" })),
    ).toContain("users_polite_particle_check");
  });
});

describe("messages", () => {
  it("rejects an outbound 'sent' message without approved_by", async () => {
    const msg = await pgError(
      t.db.insert(messages).values({ leadId, contactId, direction: "out", body: "สวัสดีค่ะ", status: "sent" }),
    );
    expect(msg).toContain("messages_sent_out_requires_approval_check");
  });

  it("accepts an outbound 'sent' message with approved_by, and an inbound one without", async () => {
    await t.db
      .insert(messages)
      .values({ leadId, contactId, direction: "out", body: "สวัสดีค่ะ", status: "sent", approvedBy: userId });
    await t.db.insert(messages).values({ leadId, contactId, direction: "in", body: "สนใจครับ", status: "sent" });
  });
});

describe("activities (append-only)", () => {
  it("allows INSERT but rejects UPDATE and DELETE", async () => {
    const [a] = await t.db
      .insert(activities)
      .values({ leadId, actorId: userId, type: "note", payload: { text: "โทรนัดแล้ว" } })
      .returning();
    expect(await pgError(t.db.update(activities).set({ type: "call" }).where(eq(activities.id, a!.id)))).toContain(
      "append-only",
    );
    expect(await pgError(t.db.delete(activities).where(eq(activities.id, a!.id)))).toContain("append-only");
  });
});

describe("Thai name search (pg_trgm)", () => {
  beforeAll(async () => {
    await t.db.insert(contacts).values([{ fullName: "สมหญิง รักไทย" }, { fullName: "John Smith" }]);
    await t.db.insert(companies).values({ name: "บริษัท สยามดิจิทัล จำกัด" });
  });

  it("finds a Thai contact by partial name with ILIKE (served by the trigram index)", async () => {
    const rows = await t.db
      .select({ name: contacts.fullName })
      .from(contacts)
      .where(sql`${contacts.fullName} ILIKE ${"%ใจดี%"}`);
    expect(rows.map((r) => r.name)).toEqual(["สมชาย ใจดี"]);
  });

  it("finds a Thai company by partial name", async () => {
    const rows = await t.db
      .select({ name: companies.name })
      .from(companies)
      .where(sql`${companies.name} ILIKE ${"%สยาม%"}`);
    expect(rows).toHaveLength(1);
  });

  it("produces trigrams for Thai text, so fuzzy similarity works", async () => {
    const [row] = await t.client.query<{ sim: number }>(`SELECT similarity('สมชาย ใจดี', 'สมชาย') AS sim`).then((r) => r.rows);
    expect(row!.sim).toBeGreaterThan(0.3);
  });
});
