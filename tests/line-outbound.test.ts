// Outbound LINE: approval first, retry key reuse, backoff on 5xx/timeout, stop on 4xx, failed + Retry, simulate_line_down.
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, appSettings, contacts, leads, messages, users } from "@/server/db/schema";
import { DEMO_SALES_EMAIL, seedDatabase } from "@/server/db/seed";
import { createMockLineAdapter } from "@/server/services/line/adapter";
import { approveAndSend, retryMessage } from "@/server/services/line/outbound";
import type { Actor } from "@/server/services/leads";
import { createTestDb, type TestDb } from "./helpers/test-db";

let t: TestDb;
let actor: Actor;
let leadId: string;
const sleeps: number[] = [];
const deps = (adapter: ReturnType<typeof createMockLineAdapter>) => ({ adapter, sleep: async (ms: number) => void sleeps.push(ms) });

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { demoPassword: "test-demo-password", counts: { users: 3, companies: 5, contacts: 10, leads: 4 } });
  const [u] = await t.db.select().from(users).where(eq(users.email, DEMO_SALES_EMAIL));
  actor = { id: u!.id, role: u!.role };
  const [c] = await t.db.insert(contacts).values({ fullName: "ลูกค้า LINE", lineUserId: "Uoutbound000000000000000000000001" }).returning();
  const [l] = await t.db.insert(leads).values({ contactId: c!.id, title: "LINE lead", source: "line" }).returning();
  leadId = l!.id;
});
afterAll(async () => {
  await t.close();
});

const setDown = (v: boolean) => t.db.insert(appSettings).values({ key: "simulate_line_down", value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v } });
const acts = async (type: "note" | "message_sent") =>
  (await t.db.select({ n: count() }).from(activities).where(and(eq(activities.leadId, leadId), eq(activities.type, type))))[0]!.n;

describe("approveAndSend", () => {
  it("sends once, records approver, retry key, status sent and a message_sent activity; adds the 3 Quick Replies", async () => {
    await setDown(false);
    const adapter = createMockLineAdapter();
    const before = await acts("message_sent");
    const msg = await approveAndSend(t.db, actor, { leadId, body: "สวัสดีครับ" }, deps(adapter));
    expect(msg).toMatchObject({ direction: "out", status: "sent", approvedBy: actor.id, attempts: 1 });
    expect(msg.retryKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(msg.lineMessageId).toMatch(/^mock-/);
    expect(adapter.outbox).toHaveLength(1);
    expect(adapter.outbox[0]).toMatchObject({ retryKey: msg.retryKey, text: "สวัสดีครับ" });
    expect(adapter.outbox[0]!.quickReplies?.map((q) => q.label)).toEqual(["นัดคุย", "ขอใบเสนอราคา", "ไม่สนใจ"]);
    expect(await acts("message_sent")).toBe(before + 1);
  });

  it("retries 5xx with backoff, using the same retry key each time, and still delivers once", async () => {
    const adapter = createMockLineAdapter();
    adapter.failNext("http_500", "timeout");
    sleeps.length = 0;
    const msg = await approveAndSend(t.db, actor, { leadId, body: "retry then ok" }, deps(adapter));
    expect(msg.status).toBe("sent");
    expect(msg.attempts).toBe(3);
    expect(adapter.attempts.map((a) => a.retryKey)).toEqual([msg.retryKey, msg.retryKey, msg.retryKey]);
    expect(adapter.outbox).toHaveLength(1);
    expect(sleeps).toEqual([250, 750]);
  });

  it("stops at the first 4xx: one attempt, status failed, draft text kept, no message_sent activity", async () => {
    const adapter = createMockLineAdapter();
    adapter.failNext("http_400");
    const before = await acts("message_sent");
    const msg = await approveAndSend(t.db, actor, { leadId, body: "bad request" }, deps(adapter));
    expect(msg).toMatchObject({ status: "failed", attempts: 1, body: "bad request" });
    expect(adapter.attempts).toHaveLength(1);
    expect(await acts("message_sent")).toBe(before);
  });

  it("gives up after 3 failed attempts on 5xx", async () => {
    const adapter = createMockLineAdapter();
    adapter.failNext("http_500", "http_500", "http_500");
    const msg = await approveAndSend(t.db, actor, { leadId, body: "always down" }, deps(adapter));
    expect(msg).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("an unexpected error while sending leaves the message failed (Retry available), never stuck in approved", async () => {
    const adapter = createMockLineAdapter();
    adapter.push = async () => {
      throw new Error("boom");
    };
    const msg = await approveAndSend(t.db, actor, { leadId, body: "crash" }, deps(adapter));
    expect(msg.status).toBe("failed");
    const good = createMockLineAdapter();
    expect((await retryMessage(t.db, actor, msg.id, deps(good))).status).toBe("sent");
  });

  it("refuses a contact with no LINE account before storing anything", async () => {
    const [c] = await t.db.insert(contacts).values({ fullName: "No LINE" }).returning();
    const [l] = await t.db.insert(leads).values({ contactId: c!.id, title: "no line", source: "manual" }).returning();
    const adapter = createMockLineAdapter();
    await expect(approveAndSend(t.db, actor, { leadId: l!.id, body: "x" }, deps(adapter))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await t.db.select().from(messages).where(eq(messages.leadId, l!.id))).toHaveLength(0);
    expect(adapter.attempts).toHaveLength(0);
  });
});

describe("retry", () => {
  it("Retry reuses the SAME retry key, ends sent, and LINE gets one message", async () => {
    const adapter = createMockLineAdapter();
    adapter.failNext("http_500", "http_500", "http_500");
    const failed = await approveAndSend(t.db, actor, { leadId, body: "will retry" }, deps(adapter));
    expect(failed.status).toBe("failed");

    const retried = await retryMessage(t.db, actor, failed.id, deps(adapter));
    expect(retried).toMatchObject({ status: "sent", retryKey: failed.retryKey, attempts: 4 });
    expect(new Set(adapter.attempts.map((a) => a.retryKey))).toEqual(new Set([failed.retryKey]));
    expect(adapter.outbox).toHaveLength(1);
  });

  it("a message that LINE already accepted is not delivered twice (duplicate retry key counts as sent)", async () => {
    const adapter = createMockLineAdapter();
    const sent = await approveAndSend(t.db, actor, { leadId, body: "once" }, deps(adapter));
    // Pretend our bookkeeping lost the success: the row says failed, LINE already has the key.
    await t.db.update(messages).set({ status: "failed" }).where(eq(messages.id, sent.id));
    const retried = await retryMessage(t.db, actor, sent.id, deps(adapter));
    expect(retried.status).toBe("sent");
    expect(adapter.outbox).toHaveLength(1);
  });

  it("only a failed message can be retried", async () => {
    const adapter = createMockLineAdapter();
    const sent = await approveAndSend(t.db, actor, { leadId, body: "fine" }, deps(adapter));
    await expect(retryMessage(t.db, actor, sent.id, deps(adapter))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("each approval and retry writes an activity row", async () => {
    const adapter = createMockLineAdapter();
    adapter.failNext("http_400");
    const before = await acts("note");
    const failed = await approveAndSend(t.db, actor, { leadId, body: "audit" }, deps(adapter));
    await retryMessage(t.db, actor, failed.id, deps(adapter));
    expect(await acts("note")).toBe(before + 2);
  });
});

describe("simulate_line_down", () => {
  it("forces the failure path without calling LINE, keeps the draft, and recovers when switched off", async () => {
    await setDown(true);
    const adapter = createMockLineAdapter();
    const msg = await approveAndSend(t.db, actor, { leadId, body: "demo outage" }, deps(adapter));
    expect(msg).toMatchObject({ status: "failed", attempts: 3, body: "demo outage" });
    expect(adapter.attempts).toHaveLength(0);

    await setDown(false);
    const retried = await retryMessage(t.db, actor, msg.id, deps(adapter));
    expect(retried.status).toBe("sent");
    expect(adapter.outbox).toHaveLength(1);
  });
});
