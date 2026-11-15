// LINE webhook (R24c): signature, dedupe, new user mapping, PDPA notice, postbacks. Real Postgres (pglite), mock LINE.
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, contacts, leads, lineEvents, messages, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { quickReplyBoostTotal } from "@/server/services/ai-suggestions";
import { createMockLineAdapter } from "@/server/services/line/adapter";
import { privacyNoticeText, postbackData, SCORE_BASELINE } from "@/server/services/line/notice";
import { signLineBody } from "@/server/services/line/signature";
import { handleLineWebhook } from "@/server/services/line/webhook";
import { createTestDb, type TestDb } from "./helpers/test-db";

const SECRET = "test-channel-secret";
let t: TestDb;
let n = 0;
const uid = () => `U${String(++n).padStart(32, "0")}`;
const eid = () => `evt-${++n}`;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

/** Posts a signed webhook and waits for the background processing, as after() would run it. */
async function post(events: object[], adapter = createMockLineAdapter(), opts: { signature?: string; secret?: string; env?: Record<string, string | undefined> } = {}) {
  const rawBody = JSON.stringify({ destination: "Udest", events });
  const tasks: Promise<void>[] = [];
  const result = await handleLineWebhook(t.db, {
    rawBody,
    signature: opts.signature ?? signLineBody(SECRET, rawBody),
    secret: opts.secret ?? SECRET,
    adapter,
    env: opts.env ?? {},
    schedule: (task) => void tasks.push(task()),
    sleep: async () => {},
  });
  await Promise.all(tasks);
  return { result, adapter };
}
const textEvent = (userId: string, text: string, id = eid()) => ({
  type: "message",
  webhookEventId: id,
  source: { type: "user", userId },
  message: { id: `m-${id}`, type: "text", text },
});
const postbackEvent = (userId: string, data: string, id = eid()) => ({ type: "postback", webhookEventId: id, source: { type: "user", userId }, postback: { data } });
const rows = async (table: typeof lineEvents | typeof messages | typeof contacts) => (await t.db.select({ n: count() }).from(table))[0]!.n;
const contactOf = async (userId: string) => (await t.db.select().from(contacts).where(eq(contacts.lineUserId, userId)))[0]!;
const countActs = async (leadId: string, type: "quick_reply" | "consent" | "message_received") =>
  (await t.db.select({ n: count() }).from(activities).where(and(eq(activities.leadId, leadId), eq(activities.type, type))))[0]!.n;

describe("signature", () => {
  it("rejects a bad signature with 401 and stores nothing", async () => {
    const before = [await rows(lineEvents), await rows(messages), await rows(contacts)];
    const user = uid();
    await expect(post([textEvent(user, "hello")], undefined, { signature: "bm90LXRoZS1zaWduYXR1cmU=" })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(post([textEvent(user, "hello")], undefined, { secret: "another-secret" })).rejects.toBeInstanceOf(AppError);
    await expect(post([textEvent(user, "hello")], undefined, { secret: "" })).rejects.toMatchObject({ status: 401 }); // unconfigured: fail closed
    expect([await rows(lineEvents), await rows(messages), await rows(contacts)]).toEqual(before);
  });

  it("rejects the public .env.example placeholder as a secret", async () => {
    const placeholder = "replace-with-your-line-channel-secret";
    const rawBody = JSON.stringify({ events: [] });
    await expect(post([], undefined, { secret: placeholder, signature: signLineBody(placeholder, rawBody) })).rejects.toMatchObject({ status: 401 });
  });

  it("accepts an empty events array (the console's Verify button)", async () => {
    const { result } = await post([]);
    expect(result).toEqual({ received: 0, fresh: 0 });
  });
});

describe("dedupe", () => {
  it("the same event twice gives one line_events row and one message", async () => {
    const user = uid();
    const ev = textEvent(user, "สนใจครับ");
    await post([ev]);
    const second = await post([ev]);
    expect(second.result.fresh).toBe(0);
    expect((await t.db.select().from(lineEvents).where(eq(lineEvents.webhookEventId, ev.webhookEventId))).length).toBe(1);
    const c = await contactOf(user);
    expect((await t.db.select().from(messages).where(eq(messages.contactId, c.id))).length).toBe(1);
  });

  it("a redelivery of an event whose processing failed is processed once", async () => {
    const user = uid();
    const ev = textEvent(user, "retry me");
    await post([ev]);
    // Simulate a crash after the event was stored: processing had failed.
    await t.db.update(lineEvents).set({ processedAt: null, error: "Error" }).where(eq(lineEvents.webhookEventId, ev.webhookEventId));
    const c = await contactOf(user);
    const again = await post([ev]);
    expect(again.result.fresh).toBe(1);
    const [row] = await t.db.select().from(lineEvents).where(eq(lineEvents.webhookEventId, ev.webhookEventId));
    expect(row!.processedAt).not.toBeNull();
    expect(row!.error).toBeNull();
    expect((await t.db.select().from(messages).where(eq(messages.contactId, c.id))).length).toBe(1);
  });
});

describe("new LINE user", () => {
  it("creates a contact and a source=line, stage=new lead with the profile name, and stores the message + activity", async () => {
    const user = uid();
    const adapter = createMockLineAdapter();
    adapter.setProfile(user, "สมชาย ใจดี");
    await post([textEvent(user, "ขอราคาหน่อย")], adapter);
    const c = await contactOf(user);
    expect(c.fullName).toBe("สมชาย ใจดี");
    const [lead] = await t.db.select().from(leads).where(eq(leads.contactId, c.id));
    expect(lead).toMatchObject({ source: "line", stage: "new" });
    const [msg] = await t.db.select().from(messages).where(eq(messages.contactId, c.id));
    expect(msg).toMatchObject({ direction: "in", body: "ขอราคาหน่อย", leadId: lead!.id });
    expect(await countActs(lead!.id, "message_received")).toBe(1);
  });

  it("uses a placeholder name when the profile call fails", async () => {
    const user = uid();
    const adapter = createMockLineAdapter();
    adapter.failProfiles(true);
    await post([textEvent(user, "hi")], adapter);
    expect((await contactOf(user)).fullName).toBe(`LINE user ${user.slice(-4)}`);
  });

  it("a second message from a known user reuses the contact and open lead and does not fetch the profile again", async () => {
    const user = uid();
    const adapter = createMockLineAdapter();
    await post([textEvent(user, "one")], adapter);
    await post([textEvent(user, "two")], adapter);
    const c = await contactOf(user);
    expect((await t.db.select().from(leads).where(eq(leads.contactId, c.id))).length).toBe(1);
    expect((await t.db.select().from(messages).where(eq(messages.contactId, c.id))).length).toBe(2);
    expect(adapter.profileCalls).toHaveLength(1);
  });

  it("stores a placeholder for a non-text message", async () => {
    const user = uid();
    const id = eid();
    await post([{ type: "message", webhookEventId: id, source: { userId: user }, message: { id: "s1", type: "sticker" } }]);
    const [msg] = await t.db.select().from(messages).where(eq(messages.contactId, (await contactOf(user)).id));
    expect(msg!.body).toBe("[sticker]");
  });
});

describe("owner of a new LINE lead", () => {
  const leadOwner = async (userId: string) => (await t.db.select().from(leads).where(eq(leads.contactId, (await contactOf(userId)).id)))[0]!.ownerId;
  // Explicit createdAt: "first" must be deterministic, not decided by the id tiebreak.
  let tick = 0;
  const mkUser = async (email: string, role: "admin" | "sales") =>
    (await t.db.insert(users).values({ email, name: email, passwordHash: "x", role, politeParticle: "ครับ", createdAt: new Date(Date.UTC(2020, 0, 1 + tick++)) }).returning())[0]!.id;
  let ids: { admin: string; first: string; second: string };

  beforeAll(async () => {
    // Oldest account is an admin: "first sales user" must skip it.
    ids = { admin: await mkUser("owner-admin@example.com", "admin"), first: await mkUser("owner-first@example.com", "sales"), second: await mkUser("owner-second@example.com", "sales") };
  });

  it("assigns LINE_DEFAULT_OWNER_EMAIL's user (case-insensitive)", async () => {
    const user = uid();
    await post([textEvent(user, "hi")], undefined, { env: { LINE_DEFAULT_OWNER_EMAIL: "Owner-Second@Example.com" } });
    expect(await leadOwner(user)).toBe(ids.second);
  });

  it("with the variable unset, uses the first sales user, not an admin", async () => {
    const user = uid();
    await post([textEvent(user, "hi")]);
    expect(await leadOwner(user)).toBe(ids.first);
  });

  it("with an email that matches nobody, falls back to the first sales user", async () => {
    const user = uid();
    await post([textEvent(user, "hi")], undefined, { env: { LINE_DEFAULT_OWNER_EMAIL: "nobody@example.com" } });
    expect(await leadOwner(user)).toBe(ids.first);
  });

  it("an existing contact's own owner wins over the default", async () => {
    const user = uid();
    await t.db.insert(contacts).values({ fullName: "Has owner", lineUserId: user, ownerId: ids.second });
    await post([textEvent(user, "hi")]);
    expect(await leadOwner(user)).toBe(ids.second);
  });
});

describe("PDPA privacy notice", () => {
  it("the first message gets the fixed notice, records consent_at and one consent activity", async () => {
    const user = uid();
    const { adapter } = await post([textEvent(user, "hello")]);
    expect(adapter.outbox).toHaveLength(1);
    expect(adapter.outbox[0]).toMatchObject({ to: user, text: privacyNoticeText() });
    expect(adapter.outbox[0]!.quickReplies).toBeUndefined();
    const c = await contactOf(user);
    expect(c.consentAt).not.toBeNull();
    const [lead] = await t.db.select().from(leads).where(eq(leads.contactId, c.id));
    expect(await countActs(lead!.id, "consent")).toBe(1);
    // The notice is an activity, not a messages row.
    expect((await t.db.select().from(messages).where(eq(messages.contactId, c.id))).every((m) => m.direction === "in")).toBe(true);
  });

  it("the notice is sent once: a second message gets no second notice", async () => {
    const user = uid();
    const adapter = createMockLineAdapter();
    await post([textEvent(user, "one")], adapter);
    await post([textEvent(user, "two")], adapter);
    expect(adapter.outbox).toHaveLength(1);
  });

  it("if LINE rejects the notice, consent_at stays empty and the next message tries again", async () => {
    const user = uid();
    const adapter = createMockLineAdapter();
    adapter.failNext("http_400");
    await post([textEvent(user, "one")], adapter);
    expect((await contactOf(user)).consentAt).toBeNull();
    await post([textEvent(user, "two")], adapter);
    expect((await contactOf(user)).consentAt).not.toBeNull();
    expect(adapter.outbox).toHaveLength(1);
  });

  it("uses APP_URL in the link", () => {
    expect(privacyNoticeText({ APP_URL: "https://crm.example.com/" })).toContain("https://crm.example.com/privacy");
  });
});

describe("postback (Quick Reply)", () => {
  async function leadFor(user: string) {
    await post([textEvent(user, "hi")]);
    const c = await contactOf(user);
    const [lead] = await t.db.select().from(leads).where(eq(leads.contactId, c.id));
    return lead!;
  }
  const scoreOf = async (id: string) => (await t.db.select({ s: leads.score }).from(leads).where(eq(leads.id, id)))[0]!.s;

  it("creates a quick_reply activity and adjusts the score", async () => {
    const lead = await leadFor(uid());
    const c = await t.db.select().from(contacts).where(eq(contacts.id, lead.contactId));
    await post([postbackEvent(c[0]!.lineUserId!, "action=book_call")]);
    expect(await countActs(lead.id, "quick_reply")).toBe(1);
    expect(await scoreOf(lead.id)).toBe(60);
  });

  it("the same postback event twice is ignored the second time", async () => {
    const lead = await leadFor(uid());
    const userId = (await t.db.select().from(contacts).where(eq(contacts.id, lead.contactId)))[0]!.lineUserId!;
    const ev = postbackEvent(userId, "action=request_quote");
    await post([ev]);
    await post([ev]);
    expect(await countActs(lead.id, "quick_reply")).toBe(1);
    expect(await scoreOf(lead.id)).toBe(65);
  });

  it("tapping the same button again (new event id) is logged but moves the score only once per lead", async () => {
    const lead = await leadFor(uid());
    const userId = (await t.db.select().from(contacts).where(eq(contacts.id, lead.contactId)))[0]!.lineUserId!;
    await post([postbackEvent(userId, "action=book_call")]);
    await post([postbackEvent(userId, "action=book_call")]);
    await post([postbackEvent(userId, "action=book_call")]);
    expect(await countActs(lead.id, "quick_reply")).toBe(3);
    expect(await scoreOf(lead.id)).toBe(60);
    // A different button still counts once, and then also stops.
    await post([postbackEvent(userId, "action=request_quote")]);
    await post([postbackEvent(userId, "action=request_quote")]);
    expect(await scoreOf(lead.id)).toBe(75);
    const flags = (await t.db.select().from(activities).where(and(eq(activities.leadId, lead.id), eq(activities.type, "quick_reply")))).map((a) => a.payload.scoreChanged);
    expect(flags.filter(Boolean)).toHaveLength(2);
  });

  it("not_interested lowers the score and the score never leaves 0-100", async () => {
    const lead = await leadFor(uid());
    const userId = (await t.db.select().from(contacts).where(eq(contacts.id, lead.contactId)))[0]!.lineUserId!;
    await t.db.update(leads).set({ score: 5 }).where(eq(leads.id, lead.id));
    await post([postbackEvent(userId, "action=not_interested")]);
    expect(await scoreOf(lead.id)).toBe(0);
  });

  it("the boost Accept keeps equals what the handler really added: two buttons and a repeat tap", async () => {
    const lead = await leadFor(uid());
    const userId = (await t.db.select().from(contacts).where(eq(contacts.id, lead.contactId)))[0]!.lineUserId!;
    const start = (await scoreOf(lead.id)) ?? SCORE_BASELINE;
    await post([postbackEvent(userId, "action=book_call")]);
    await post([postbackEvent(userId, "action=request_quote")]);
    await post([postbackEvent(userId, "action=book_call")]); // repeat: logged, score unchanged
    expect(await countActs(lead.id, "quick_reply")).toBe(3);
    const added = (await scoreOf(lead.id))! - start;
    expect(await quickReplyBoostTotal(t.db, lead.id)).toBe(added);
    expect(added).toBe(25);
  });

  it("unknown postback data changes nothing", async () => {
    const lead = await leadFor(uid());
    const userId = (await t.db.select().from(contacts).where(eq(contacts.id, lead.contactId)))[0]!.lineUserId!;
    await post([postbackEvent(userId, "action=delete_everything"), postbackEvent(userId, postbackData("book_call", "not-a-uuid"))]);
    expect(await countActs(lead.id, "quick_reply")).toBe(1); // only the well-formed one (mid dropped) applies
  });
});
