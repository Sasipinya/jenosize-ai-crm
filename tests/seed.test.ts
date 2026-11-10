// Seed smoke test on pglite: exact target counts, the 5 story leads, synthetic-only PII, idempotent.
import { and, count, eq, inArray, isNotNull, isNull, like, not } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, companies, contacts, leads, messages, users } from "@/server/db/schema";
import { DEMO_ADMIN_EMAIL, DEMO_SALES_EMAIL, seedDatabase, STORY_LEAD_IDS, type SeedResult } from "@/server/db/seed";
import { createTestDb, type TestDb } from "./helpers/test-db";

let t: TestDb;
let result: SeedResult;

beforeAll(async () => {
  t = await createTestDb();
  result = await seedDatabase(t.db, { demoPassword: "test-demo-password" });
});

afterAll(async () => {
  await t.close();
});

const total = async (table: PgTable) => (await t.db.select({ n: count() }).from(table))[0]!.n;

describe("seedDatabase", () => {
  it("creates exactly the target volumes", async () => {
    expect(result.skipped).toBe(false);
    expect(await total(users)).toBe(20);
    expect(await total(companies)).toBe(150);
    expect(await total(contacts)).toBe(2000);
    expect(await total(leads)).toBe(300);
    expect(await total(activities)).toBeGreaterThan(300);
    expect(await total(messages)).toBeGreaterThan(0);
  });

  it("creates the documented demo admin and sales users", async () => {
    const rows = await t.db.select().from(users).where(inArray(users.email, [DEMO_ADMIN_EMAIL, DEMO_SALES_EMAIL]));
    expect(rows.map((u) => [u.email, u.role]).sort()).toEqual([
      [DEMO_ADMIN_EMAIL, "admin"],
      [DEMO_SALES_EMAIL, "sales"],
    ]);
    expect(rows.every((u) => u.passwordHash.startsWith("$2"))).toBe(true);
  });

  it("creates the 5 story leads with their scenario data", async () => {
    const story = await t.db.select().from(leads).where(inArray(leads.id, Object.values(STORY_LEAD_IDS)));
    expect(story).toHaveLength(5);
    const byId = new Map(story.map((l) => [l.id, l]));
    expect(byId.get(STORY_LEAD_IDS.case1PriceNoBudget)).toMatchObject({ stage: "new", source: "line", valueThb: 0 });
    expect(byId.get(STORY_LEAD_IDS.case2StaleProposal)?.stage).toBe("proposal");
    expect(byId.get(STORY_LEAD_IDS.case4Lost)).toMatchObject({ stage: "lost" });
    expect(byId.get(STORY_LEAD_IDS.case4Lost)?.lostReason).toBeTruthy();
    expect(byId.get(STORY_LEAD_IDS.case6MinimalInfo)?.companyId).toBeNull();

    const injection = await t.db.select().from(messages).where(eq(messages.leadId, STORY_LEAD_IDS.case3PromptInjection));
    expect(injection[0]?.body).toContain("ignore previous instructions");

    // Case 2: nothing happened on the stale proposal in the last 21 days.
    const stale = await t.db.select().from(activities).where(eq(activities.leadId, STORY_LEAD_IDS.case2StaleProposal));
    const newest = Math.max(...stale.map((a) => a.createdAt.getTime()));
    expect(Date.now() - newest).toBeGreaterThanOrEqual(21 * 86_400_000 - 60_000);
  });

  it("uses only synthetic contact data (example.com emails, 000- phones)", async () => {
    const badEmail = await t.db
      .select({ n: count() })
      .from(contacts)
      .where(not(like(contacts.email, "%@example.com")));
    expect(badEmail[0]!.n).toBe(0);
    const badUserEmail = await t.db.select({ n: count() }).from(users).where(not(like(users.email, "%@example.com")));
    expect(badUserEmail[0]!.n).toBe(0);
    const phones = await t.db.select({ phone: contacts.phone }).from(contacts).where(isNotNull(contacts.phone));
    expect(phones.length).toBeGreaterThan(0);
    expect(phones.every((p) => p.phone!.startsWith("000-"))).toBe(true);
  });

  it("every lost lead has a reason and every outbound sent message has an approver", async () => {
    // These are also DB constraints; this proves the seed data is valid, not just accepted.
    const lost = await t.db.select().from(leads).where(eq(leads.stage, "lost"));
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.every((l) => l.lostReason)).toBe(true);
    const unapproved = await t.db
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.direction, "out"), eq(messages.status, "sent"), isNull(messages.approvedBy)));
    expect(unapproved[0]!.n).toBe(0);
  });

  it("is idempotent: a second run is skipped and inserts nothing", async () => {
    const again = await seedDatabase(t.db, { demoPassword: "test-demo-password" });
    expect(again).toEqual({ skipped: true });
    expect(await total(leads)).toBe(300);
  });
});
