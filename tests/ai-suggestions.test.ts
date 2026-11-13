// AI suggestion service: pending-only output, per-lead cache, fallback, and the decide-once guard.
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockAdapter } from "@/server/services/ai-adapters";
import { aiSuggestions, activities, appSettings, contacts, leads, users } from "@/server/db/schema";
import { seedDatabase, DEMO_SALES_EMAIL } from "@/server/db/seed";
import { addNote, changeStage, createLead, type Actor } from "@/server/services/leads";
import { decideSuggestion, suggestForLead } from "@/server/services/ai-suggestions";
import { suggestionOutputSchema } from "../skills/crm-copilot/schema";
import { createTestDb, type TestDb } from "./helpers/test-db";

let t: TestDb;
let actor: Actor;
let contactId: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { demoPassword: "test-demo-password", counts: { users: 3, companies: 5, contacts: 10, leads: 4 } });
  const [u] = await t.db.select().from(users).where(eq(users.email, DEMO_SALES_EMAIL));
  actor = { id: u!.id, role: u!.role };
  const [c] = await t.db.select().from(contacts).limit(1);
  contactId = c!.id;
});
afterAll(async () => {
  await t.close();
});

const newLead = (title: string) => createLead(t.db, actor, { title, contactId, companyId: null, ownerId: null, valueThb: 0 });
const countActivities = async (leadId: string, type: "ai_accepted" | "note") =>
  (await t.db.select({ n: count() }).from(activities).where(and(eq(activities.leadId, leadId), eq(activities.type, type))))[0]!.n;
const decided = (id: string, input: Parameters<typeof decideSuggestion>[3]) => decideSuggestion(t.db, actor, id, input);

describe("suggestForLead", () => {
  it("stores a pending, schema-valid suggestion and changes nothing else", async () => {
    const lead = await newLead("Pending only");
    const before = await countActivities(lead.id, "note");
    const { suggestion, cached } = await suggestForLead(t.db, actor, lead.id, { adapter: createMockAdapter() });
    expect(cached).toBe(false);
    expect(suggestion.status).toBe("pending");
    expect(suggestion.source).toBe("llm");
    expect(suggestion.model).toBe("mock");
    expect(suggestionOutputSchema.safeParse(suggestion.originalOutput).success).toBe(true);

    const [after] = await t.db.select().from(leads).where(eq(leads.id, lead.id));
    expect(after!.stage).toBe("new");
    expect(after!.score).toBeNull();
    expect(await countActivities(lead.id, "note")).toBe(before);
  });

  it("serves the cached suggestion until there is a new activity or message", async () => {
    const lead = await newLead("Cache");
    const adapter = createMockAdapter();
    const first = await suggestForLead(t.db, actor, lead.id, { adapter });
    const second = await suggestForLead(t.db, actor, lead.id, { adapter });
    expect(second.cached).toBe(true);
    expect(second.suggestion.id).toBe(first.suggestion.id);
    expect(adapter.calls).toHaveLength(1);

    await sleep(15);
    await addNote(t.db, actor, lead.id, { type: "note", text: "Customer called back" });
    const third = await suggestForLead(t.db, actor, lead.id, { adapter });
    expect(third.cached).toBe(false);
    expect(adapter.calls).toHaveLength(2);

    // Accepting writes an ai_accepted activity; that must not trigger another model call.
    await decided(third.suggestion.id, { action: "accept" });
    const fourth = await suggestForLead(t.db, actor, lead.id, { adapter });
    expect(fourth.cached).toBe(true);
    expect(adapter.calls).toHaveLength(2);
  });

  it("falls back with source 'fallback' when the model fails twice", async () => {
    const lead = await newLead("Fallback");
    const adapter = createMockAdapter({ mode: "invalid_json" });
    const { suggestion } = await suggestForLead(t.db, actor, lead.id, { adapter });
    expect(adapter.calls).toHaveLength(2); // first try + 1 retry
    expect(suggestion.source).toBe("fallback");
    expect(suggestion.model).toBeNull();
    expect(suggestion.status).toBe("pending");
    expect(suggestionOutputSchema.safeParse(suggestion.originalOutput).success).toBe(true);
  });

  it("uses the fallback without calling the model when simulate_ai_down is on", async () => {
    const lead = await newLead("Simulated down");
    const setFlag = (value: boolean) =>
      t.db.insert(appSettings).values({ key: "simulate_ai_down", value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
    await setFlag(true);
    const adapter = createMockAdapter();
    const { suggestion } = await suggestForLead(t.db, actor, lead.id, { adapter });
    await setFlag(false);
    expect(suggestion.source).toBe("fallback");
    expect(adapter.calls).toHaveLength(0);
  });

  it("ignores a dismissed suggestion in the cache: Refresh after a Dismiss generates a new one", async () => {
    const lead = await newLead("Dismiss then refresh");
    const adapter = createMockAdapter();
    const first = await suggestForLead(t.db, actor, lead.id, { adapter });
    await decided(first.suggestion.id, { action: "dismiss", rejectReason: "wrong_action" });

    const again = await suggestForLead(t.db, actor, lead.id, { adapter });
    expect(again.cached).toBe(false);
    expect(again.suggestion.id).not.toBe(first.suggestion.id);
    expect(again.suggestion.status).toBe("pending");
    expect(adapter.calls).toHaveLength(2);

    // The new pending one is cached as before.
    const third = await suggestForLead(t.db, actor, lead.id, { adapter });
    expect(third.cached).toBe(true);
    expect(third.suggestion.id).toBe(again.suggestion.id);
    expect(adapter.calls).toHaveLength(2);
  });

  it("fewshot_enabled=false (admin switch) sends no examples; on or missing sends them", async () => {
    const setFlag = (value: boolean) =>
      t.db.insert(appSettings).values({ key: "fewshot_enabled", value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
    const approvedLead = await newLead("Switch approved");
    const a = await suggestForLead(t.db, actor, approvedLead.id, { adapter: createMockAdapter() });
    const original = suggestionOutputSchema.parse(a.suggestion.originalOutput);
    await decided(a.suggestion.id, { action: "edit", finalOutput: { ...original, draftReply: "UNIQUE-SWITCH-REPLY" } });

    await setFlag(false);
    const offAdapter = createMockAdapter();
    await suggestForLead(t.db, actor, (await newLead("Switch off")).id, { adapter: offAdapter });
    expect(offAdapter.calls[0]!.user).not.toContain("UNIQUE-SWITCH-REPLY");
    expect(offAdapter.calls[0]!.user).not.toContain("approved_example");
    expect(offAdapter.calls[0]!.context.fewShot).toEqual([]);

    await setFlag(true);
    const onAdapter = createMockAdapter();
    await suggestForLead(t.db, actor, (await newLead("Switch on")).id, { adapter: onAdapter });
    expect(onAdapter.calls[0]!.user).toContain("UNIQUE-SWITCH-REPLY");

    await t.db.delete(appSettings).where(eq(appSettings.key, "fewshot_enabled")); // missing row = on
    const missingAdapter = createMockAdapter();
    await suggestForLead(t.db, actor, (await newLead("Switch missing")).id, { adapter: missingAdapter });
    expect(missingAdapter.calls[0]!.user).toContain("UNIQUE-SWITCH-REPLY");
    await setFlag(true);
  });

  it("uses accepted/edited replies as few-shot but never dismissed ones", async () => {
    const approvedLead = await newLead("Few-shot approved");
    const dismissedLead = await newLead("Few-shot dismissed");
    const target = await newLead("Few-shot target");

    const a = await suggestForLead(t.db, actor, approvedLead.id, { adapter: createMockAdapter() });
    const original = suggestionOutputSchema.parse(a.suggestion.originalOutput);
    await decided(a.suggestion.id, { action: "edit", finalOutput: { ...original, draftReply: "UNIQUE-APPROVED-REPLY call 081-234-5678" } });

    const [d] = await t.db
      .insert(aiSuggestions)
      .values({ leadId: dismissedLead.id, originalOutput: { ...original, draftReply: "UNIQUE-DISMISSED-REPLY" }, source: "llm", model: "mock", promptVersion: "crm-copilot/v1" })
      .returning();
    await decided(d!.id, { action: "dismiss", rejectReason: "wrong_tone" });

    const adapter = createMockAdapter();
    await suggestForLead(t.db, actor, target.id, { adapter });
    const prompt = adapter.calls[0]!.user;
    expect(prompt).toContain("UNIQUE-APPROVED-REPLY");
    expect(prompt).not.toContain("UNIQUE-DISMISSED-REPLY");
    expect(prompt).not.toContain("081-234-5678"); // approved replies are PII-redacted too
    expect(prompt).toContain("[phone]");
  });
});

describe("decideSuggestion", () => {
  async function pending(title: string) {
    const lead = await newLead(title);
    const { suggestion } = await suggestForLead(t.db, actor, lead.id, { adapter: createMockAdapter() });
    return { lead, suggestion };
  }

  it("accept sets the lead score and writes one ai_accepted activity", async () => {
    const { lead, suggestion } = await pending("Accept");
    const out = suggestionOutputSchema.parse(suggestion.originalOutput);
    const row = await decided(suggestion.id, { action: "accept" });
    expect(row.status).toBe("accepted");
    expect(row.decidedBy).toBe(actor.id);
    expect(row.finalOutput).toEqual(out);
    const [l] = await t.db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.score).toBe(out.score);
    expect(await countActivities(lead.id, "ai_accepted")).toBe(1);
  });

  it("edit keeps original and final side by side", async () => {
    const { suggestion } = await pending("Edit");
    const original = suggestionOutputSchema.parse(suggestion.originalOutput);
    const row = await decided(suggestion.id, { action: "edit", finalOutput: { ...original, draftReply: "My own wording" } });
    expect(row.status).toBe("edited");
    expect(row.originalOutput).toEqual(original);
    expect((row.finalOutput as { draftReply: string }).draftReply).toBe("My own wording");
  });

  it("rejects an edit with no changes", async () => {
    const { suggestion } = await pending("Edit nothing");
    const original = suggestionOutputSchema.parse(suggestion.originalOutput);
    await expect(decided(suggestion.id, { action: "edit", finalOutput: original })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("dismiss stores reason + note, writes no activity and leaves the score alone", async () => {
    const { lead, suggestion } = await pending("Dismiss");
    const row = await decided(suggestion.id, { action: "dismiss", rejectReason: "wrong_facts", rejectNote: "Budget was wrong" });
    expect(row.status).toBe("dismissed");
    expect(row.rejectReason).toBe("wrong_facts");
    expect(row.rejectNote).toBe("Budget was wrong");
    expect(row.decidedBy).toBe(actor.id);
    expect(row.decidedAt).not.toBeNull();
    expect(row.finalOutput).toBeNull();
    const [l] = await t.db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.score).toBeNull();
    expect(await countActivities(lead.id, "ai_accepted")).toBe(0);
  });

  it("database rejects an unknown reject_reason", async () => {
    const { suggestion } = await pending("Bad reason");
    await expect(
      t.client.query("UPDATE ai_suggestions SET status='dismissed', reject_reason='because', decided_by=$1, decided_at=now() WHERE id=$2", [actor.id, suggestion.id]),
    ).rejects.toThrow();
  });

  it("accepting the same suggestion twice: second call is 409 and only one activity exists", async () => {
    const { lead, suggestion } = await pending("Double accept");
    await decided(suggestion.id, { action: "accept" });
    await expect(decided(suggestion.id, { action: "accept" })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await countActivities(lead.id, "ai_accepted")).toBe(1);
  });

  it("two concurrent accepts: exactly one succeeds, the other is 409", async () => {
    const { lead, suggestion } = await pending("Concurrent accept");
    const results = await Promise.allSettled([decided(suggestion.id, { action: "accept" }), decided(suggestion.id, { action: "accept" })]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await countActivities(lead.id, "ai_accepted")).toBe(1);
  });

  it.each([
    ["won", { stage: "won" as const, lostReason: null }],
    ["lost", { stage: "lost" as const, lostReason: "Chose a competitor" }],
  ])("accept or edit on a %s lead is 409 and changes nothing; dismiss still works", async (_name, change) => {
    const { lead, suggestion } = await pending(`Closed ${_name}`);
    await changeStage(t.db, actor, lead.id, change);
    const [before] = await t.db.select().from(leads).where(eq(leads.id, lead.id));
    const original = suggestionOutputSchema.parse(suggestion.originalOutput);

    await expect(decided(suggestion.id, { action: "accept" })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(decided(suggestion.id, { action: "edit", finalOutput: { ...original, draftReply: "Edited" } })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    const [row] = await t.db.select().from(aiSuggestions).where(eq(aiSuggestions.id, suggestion.id));
    expect(row!.status).toBe("pending"); // still decidable
    expect(row!.finalOutput).toBeNull();
    const [after] = await t.db.select().from(leads).where(eq(leads.id, lead.id));
    expect(after!.score).toBe(before!.score);
    expect(after!.stage).toBe(before!.stage);
    expect(await countActivities(lead.id, "ai_accepted")).toBe(0);

    const dismissed = await decided(suggestion.id, { action: "dismiss", rejectReason: "wrong_action" });
    expect(dismissed.status).toBe("dismissed");
  });

  it("dismiss then accept: accept is 409 and changes nothing", async () => {
    const { lead, suggestion } = await pending("Dismiss then accept");
    await decided(suggestion.id, { action: "dismiss" });
    await expect(decided(suggestion.id, { action: "accept" })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    const [row] = await t.db.select().from(aiSuggestions).where(eq(aiSuggestions.id, suggestion.id));
    expect(row!.status).toBe("dismissed");
    const [l] = await t.db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.score).toBeNull();
    expect(await countActivities(lead.id, "ai_accepted")).toBe(0);
  });
});
