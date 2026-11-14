// Outbound LINE: approval first, retry key reuse, backoff on 5xx/timeout, stop on 4xx, failed + Retry, simulate_line_down.
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
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

/** pglite's now() follows the JS clock, so faking Date moves the database clock too: used to let the 60 s window pass. */
async function withClock(fn: (advance: (ms: number) => void) => Promise<void>) {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
  try {
    await fn((ms) => vi.setSystemTime(Date.now() + ms));
  } finally {
    vi.useRealTimers();
  }
}
const setDown =(v: boolean) => t.db.insert(appSettings).values({ key: "simulate_line_down", value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v } });
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

describe("double-send guard", () => {
  it("rejects (409) the same text sent to the same lead within 60 s, and sends nothing", async () => {
    const adapter = createMockLineAdapter();
    await approveAndSend(t.db, actor, { leadId, body: "dup guard text" }, deps(adapter));
    const before = await t.db.select().from(messages).where(eq(messages.leadId, leadId));
    await expect(approveAndSend(t.db, actor, { leadId, body: "dup guard text" }, deps(adapter))).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(adapter.outbox).toHaveLength(1);
    expect(await t.db.select().from(messages).where(eq(messages.leadId, leadId))).toHaveLength(before.length);
  });

  it("two simultaneous identical sends: one goes out, one is rejected", async () => {
    const adapter = createMockLineAdapter();
    const results = await Promise.allSettled([
      approveAndSend(t.db, actor, { leadId, body: "double click" }, deps(adapter)),
      approveAndSend(t.db, actor, { leadId, body: "double click" }, deps(adapter)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(adapter.outbox).toHaveLength(1);
  });

  it("different text is allowed, and the same text is allowed again after the window", async () => {
    const adapter = createMockLineAdapter();
    await withClock(async (advance) => {
      await approveAndSend(t.db, actor, { leadId, body: "window text" }, deps(adapter));
      await approveAndSend(t.db, actor, { leadId, body: "window text 2" }, deps(adapter));
      advance(120_000);
      const again = await approveAndSend(t.db, actor, { leadId, body: "window text" }, deps(adapter));
      expect(again.status).toBe("sent");
    });
  });

  it("a Retry restarts the window: the same text is blocked after an OLD failed message was just retried", async () => {
    const adapter = createMockLineAdapter();
    await withClock(async (advance) => {
      adapter.failNext("http_400", "http_400");
      const f1 = await approveAndSend(t.db, actor, { leadId, body: "old failed text" }, deps(adapter)); // t0
      advance(300_000);
      const f2 = await approveAndSend(t.db, actor, { leadId, body: "old failed text" }, deps(adapter)); // a failed row does not block
      expect([f1.status, f2.status]).toEqual(["failed", "failed"]);

      expect((await retryMessage(t.db, actor, f1.id, deps(adapter))).status).toBe("sent"); // f1 is 5 minutes old
      // The second Retry and a fresh Send of the same text must both be refused: f1 was approved seconds ago.
      await expect(retryMessage(t.db, actor, f2.id, deps(adapter))).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(approveAndSend(t.db, actor, { leadId, body: "old failed text" }, deps(adapter))).rejects.toMatchObject({ code: "CONFLICT" });
      expect(adapter.outbox).toHaveLength(1);

      advance(120_000); // the window passes
      expect((await retryMessage(t.db, actor, f2.id, deps(adapter))).status).toBe("sent");
    });
  });

  it("the 60 s window is computed by the database (now()), not from the app clock", async () => {
    // pglite's now() follows the JS clock, so skewing the app clock cannot be simulated here. Instead, capture the
    // SQL: the window must be `now() - interval '60 seconds'`, and no timestamp may be sent as a parameter.
    const queries: { sql: string; params: unknown[] }[] = [];
    const spyDb = drizzle(t.client, { schema, logger: { logQuery: (sql, params) => void queries.push({ sql, params }) } });
    const adapter = createMockLineAdapter();
    await approveAndSend(spyDb, actor, { leadId, body: "clock source text" }, deps(adapter));
    const guard = queries.find((q) => q.sql.includes('from "messages"') && q.sql.includes("interval '60 seconds'"));
    expect(guard, "duplicate-check query not found").toBeDefined();
    expect(guard!.sql).toContain("now() - interval '60 seconds'");
    expect(guard!.params.some((p) => p instanceof Date || (typeof p === "string" && /^\d{4}-\d{2}-\d{2}T/.test(p)))).toBe(false);
    // And it still blocks.
    await expect(approveAndSend(spyDb, actor, { leadId, body: "clock source text" }, deps(adapter))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a failed message does not block re-sending the same text", async () => {
    const adapter = createMockLineAdapter();
    adapter.failNext("http_400");
    const failed = await approveAndSend(t.db, actor, { leadId, body: "failed then again" }, deps(adapter));
    expect(failed.status).toBe("failed");
    const again = await approveAndSend(t.db, actor, { leadId, body: "failed then again" }, deps(adapter));
    expect(again.status).toBe("sent");
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

  it("Retry is rejected (409) when an identical message was already sent within 60 s", async () => {
    const adapter = createMockLineAdapter();
    adapter.failNext("http_400");
    const failed = await approveAndSend(t.db, actor, { leadId, body: "retry dup text" }, deps(adapter));
    expect(failed.status).toBe("failed");
    const resent = await approveAndSend(t.db, actor, { leadId, body: "retry dup text" }, deps(adapter)); // allowed: a failed row does not block
    expect(resent.status).toBe("sent");

    await expect(retryMessage(t.db, actor, failed.id, deps(adapter))).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    const [still] = await t.db.select().from(messages).where(eq(messages.id, failed.id));
    expect(still!.status).toBe("failed"); // untouched: Retry stays available
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
