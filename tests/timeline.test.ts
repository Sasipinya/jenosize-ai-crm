// Lead timeline: a message and its mirrored activity show once; labels are readable; inbound has no status.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, contacts, leads, messages } from "@/server/db/schema";
import { seedDatabase } from "@/server/db/seed";
import { describeTimelineItem } from "@/lib/timeline";
import { getLeadDetail, type TimelineItem } from "@/server/services/leads";
import { createTestDb, type TestDb } from "./helpers/test-db";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { demoPassword: "test-demo-password", counts: { users: 3, companies: 5, contacts: 10, leads: 4 } });
});
afterAll(async () => {
  await t.close();
});

async function leadWithContact() {
  const [c] = await t.db.select().from(contacts).limit(1);
  const [lead] = await t.db.insert(leads).values({ title: "Timeline", contactId: c!.id, source: "line" }).returning();
  return { lead: lead!, contactId: c!.id };
}

describe("timeline dedupe", () => {
  it("shows an inbound message once even though a message_received activity mirrors it", async () => {
    const { lead, contactId } = await leadWithContact();
    const [m] = await t.db.insert(messages).values({ leadId: lead.id, contactId, direction: "in", body: "สนใจครับ", status: "sent" }).returning();
    await t.db.insert(activities).values({ leadId: lead.id, actorId: null, type: "message_received", payload: { messageId: m!.id } });

    const { timeline } = await getLeadDetail(t.db, lead.id);
    expect(timeline.filter((i) => i.kind === "message")).toHaveLength(1);
    expect(timeline.filter((i) => i.kind === "activity" && i.type === "message_received")).toHaveLength(0);
  });

  it("also drops a message_sent mirror, but keeps mirrors with no matching message row and other activities", async () => {
    const { lead, contactId } = await leadWithContact();
    const [m] = await t.db
      .insert(messages)
      .values({ leadId: lead.id, contactId, direction: "out", body: "Hello", status: "draft" })
      .returning();
    await t.db.insert(activities).values([
      { leadId: lead.id, actorId: null, type: "message_sent", payload: { messageId: m!.id } },
      { leadId: lead.id, actorId: null, type: "message_received", payload: { messageId: "00000000-0000-4000-8000-000000000000" } },
      { leadId: lead.id, actorId: null, type: "message_received", payload: {} },
      { leadId: lead.id, actorId: null, type: "call", payload: { text: "Called" } },
    ]);

    const { timeline } = await getLeadDetail(t.db, lead.id);
    const acts = timeline.filter((i) => i.kind === "activity");
    expect(acts.map((a) => a.kind === "activity" && a.type).sort()).toEqual(["call", "message_received", "message_received"]);
    expect(timeline.filter((i) => i.kind === "message")).toHaveLength(1);
  });

  it("the seeded demo data has no duplicated message on any lead", async () => {
    const all = await t.db.select({ id: leads.id }).from(leads);
    let withMessages = 0;
    for (const { id } of all) {
      const { timeline } = await getLeadDetail(t.db, id);
      const msgs = timeline.filter((i) => i.kind === "message");
      if (msgs.length) withMessages++;
      const messageIds = new Set(msgs.map((m) => m.id));
      const duplicated = timeline.filter(
        (i) => i.kind === "activity" && (i.type === "message_received" || i.type === "message_sent") && messageIds.has(String(i.payload.messageId)),
      );
      expect(duplicated).toHaveLength(0);
    }
    expect(withMessages).toBeGreaterThan(0);
  });
});

describe("describeTimelineItem", () => {
  const at = new Date();
  const msg = (direction: string, status: string): TimelineItem => ({ kind: "message", id: "m", at, direction, status, body: "hi" });
  const act = (type: string, payload: Record<string, unknown> = {}): TimelineItem => ({ kind: "activity", id: "a", at, type, actorName: null, payload });

  it("inbound messages never show a status", () => {
    expect(describeTimelineItem(msg("in", "sent")).label).toBe("Message received");
    expect(describeTimelineItem(msg("in", "draft")).label).toBe("Message received");
    expect(describeTimelineItem(msg("in", "sent")).label).not.toMatch(/sent|\(/);
  });

  it("outbound messages show their state in words", () => {
    expect(describeTimelineItem(msg("out", "sent")).label).toBe("Message sent");
    expect(describeTimelineItem(msg("out", "draft")).label).toBe("Message draft");
    expect(describeTimelineItem(msg("out", "failed")).label).toBe("Message failed");
  });

  it("activity types get readable labels, not raw enum names", () => {
    expect(describeTimelineItem(act("ai_accepted", { status: "accepted", score: 70, nextAction: "line_reply" }))).toEqual({
      label: "AI suggestion accepted",
      text: "score 70, next: line reply",
    });
    expect(describeTimelineItem(act("ai_accepted", { status: "edited" })).label).toBe("AI suggestion accepted with edits");
    expect(describeTimelineItem(act("stage_change", { from: "new", to: "qualified" }))).toEqual({ label: "Stage changed", text: "new → qualified" });
    expect(describeTimelineItem(act("data_erased")).label).toBe("Personal data erased");
    expect(describeTimelineItem(act("quick_reply")).label).toBe("Quick reply");
    expect(describeTimelineItem(act("consent")).label).toBe("Consent recorded");
    expect(describeTimelineItem(act("something_new")).label).toBe("Something new"); // unknown type: humanised, never raw
  });
});
