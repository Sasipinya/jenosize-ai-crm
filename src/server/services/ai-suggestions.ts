// AI suggestion service. A suggestion is only ever stored as `pending`; a human decision
// (accept / edit / dismiss) is the only path that changes anything else. Accept and edit set
// leads.score and write an `ai_accepted` activity in the same transaction. Dismiss writes no
// activity: it is audited on the ai_suggestions row (status, decided_by, decided_at, reject_reason, reject_note).
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { PROMPT_VERSION } from "../../../skills/crm-copilot/prompt";
import { suggestionOutputSchema, type SuggestionOutput } from "../../../skills/crm-copilot/schema";
import type { AiDecisionInput } from "@/lib/validation/ai";
import type { Db } from "../db/client";
import { activities, aiSuggestions, appSettings, leads, users } from "../db/schema";
import { AppError } from "../errors";
import { logger } from "../logger";
import { addActivity } from "./activities";
import { adapterFromEnv, type LlmAdapter } from "./ai-adapters";
import { buildContext, latestEventAt } from "./ai-context";
import { generateSuggestion } from "./ai-generate";
import { getLeadDetail, type Actor } from "./leads";
import { QUICK_REPLIES, type QuickReplyAction } from "./line/notice";

export type SuggestionRow = typeof aiSuggestions.$inferSelect;

export async function getLatestSuggestion(db: Db, leadId: string): Promise<SuggestionRow | null> {
  const [row] = await db.select().from(aiSuggestions).where(eq(aiSuggestions.leadId, leadId)).orderBy(desc(aiSuggestions.createdAt)).limit(1);
  return row ?? null;
}

/** Latest suggestion that can still be served from cache. A dismissed one never is: Refresh after a Dismiss generates a new one. */
async function getLatestCacheable(db: Db, leadId: string): Promise<SuggestionRow | null> {
  const [row] = await db
    .select()
    .from(aiSuggestions)
    .where(and(eq(aiSuggestions.leadId, leadId), ne(aiSuggestions.status, "dismissed")))
    .orderBy(desc(aiSuggestions.createdAt))
    .limit(1);
  return row ?? null;
}

async function aiSimulatedDown(db: Db): Promise<boolean> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "simulate_ai_down")).limit(1);
  return row?.value === true;
}

/** Admin switch `fewshot_enabled` in app_settings. On when the row is missing; only an explicit false turns it off. */
async function fewShotEnabled(db: Db): Promise<boolean> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "fewshot_enabled")).limit(1);
  return row?.value !== false;
}

/** Polite particle of `userId`; if that user no longer exists, of the actor. */
async function particleFor(db: Db, userId: string, actorId: string): Promise<"ครับ" | "ค่ะ"> {
  for (const id of userId === actorId ? [actorId] : [userId, actorId]) {
    const [row] = await db.select({ politeParticle: users.politeParticle }).from(users).where(eq(users.id, id)).limit(1);
    if (row) return row.politeParticle;
  }
  throw new AppError("UNAUTHORIZED", "User not found");
}

/** The actor's 3 most recent accepted/edited replies. Dismissed suggestions are never used. */
async function approvedReplies(db: Db, actorId: string): Promise<string[]> {
  const rows = await db
    .select({ final: aiSuggestions.finalOutput })
    .from(aiSuggestions)
    .where(
      and(
        inArray(aiSuggestions.status, ["accepted", "edited"]),
        eq(aiSuggestions.decidedBy, actorId),
        isNotNull(aiSuggestions.finalOutput),
        sql`${aiSuggestions.finalOutput}->>'draftReply' IS NOT NULL`,
      ),
    )
    .orderBy(desc(aiSuggestions.decidedAt))
    .limit(3);
  return rows.map((r) => String((r.final as { draftReply: string }).draftReply));
}

/**
 * Returns the cached latest suggestion when nothing new happened on the lead (no new activity or
 * message since it was created, same prompt version). Otherwise calls the model once (15 s, 1 retry)
 * and stores a new pending suggestion. The caller passes `adapter` only in tests.
 */
export async function suggestForLead(
  db: Db,
  actor: Actor,
  leadId: string,
  deps: { adapter?: LlmAdapter | null; timeoutMs?: number; now?: Date } = {},
): Promise<{ suggestion: SuggestionRow; cached: boolean }> {
  const detail = await getLeadDetail(db, leadId);
  const newest = latestEventAt(detail.timeline);
  const latest = await getLatestCacheable(db, leadId);
  if (latest && latest.promptVersion === PROMPT_VERSION && (!newest || latest.createdAt >= newest)) {
    logger.info({ event: "ai_suggest", leadId, userId: actor.id, cached: true });
    return { suggestion: latest, cached: true };
  }

  // The reply speaks for the lead OWNER, so the owner's polite particle is used (not the person who clicked).
  // A lead with no owner falls back to the person who clicked.
  const politeParticle = await particleFor(db, detail.lead.ownerId ?? actor.id, actor.id);

  const ctx = buildContext({
    lead: detail.lead,
    contact: { fullName: detail.contact.fullName },
    company: detail.company ? { name: detail.company.name, industry: detail.company.industry } : null,
    timeline: detail.timeline,
    politeParticle,
    fewShot: (await fewShotEnabled(db)) ? await approvedReplies(db, actor.id) : [],
    now: deps.now,
  });

  const adapter = deps.adapter !== undefined ? deps.adapter : adapterFromEnv();
  const result = await generateSuggestion(ctx, { adapter, forceFallback: await aiSimulatedDown(db), timeoutMs: deps.timeoutMs });

  const [suggestion] = await db
    .insert(aiSuggestions)
    .values({
      leadId,
      originalOutput: result.output,
      source: result.source,
      model: result.model,
      promptVersion: result.promptVersion,
      status: "pending",
    })
    .returning();

  // Token and cost log. Never the prompt or the output text (customer data).
  logger.info({
    event: "ai_suggest",
    leadId,
    userId: actor.id,
    cached: false,
    adapter: adapter?.name ?? "none",
    model: adapter?.model ?? null,
    source: result.source,
    failure: result.failure,
    draftReplaced: result.draftReplaced,
    particleNormalised: result.particleNormalised,
    attempts: result.attempts,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    estimatedCostUsd: result.estimatedCostUsd,
    durationMs: result.durationMs,
  });
  return { suggestion: suggestion!, cached: false };
}

/**
 * Points the customer earned by tapping quick-reply buttons on this lead: the sum of the deltas of the taps that
 * changed the score (each button counts once). Read from the activity history, NOT from leads.score, so accepting a
 * suggestion again can never count a boost twice.
 */
export async function quickReplyBoostTotal(tx: Pick<Db, "select">, leadId: string): Promise<number> {
  const rows = await tx
    .select({ payload: activities.payload })
    .from(activities)
    .where(and(eq(activities.leadId, leadId), eq(activities.type, "quick_reply"), sql`${activities.payload}->>'scoreChanged' = 'true'`));
  const seen = new Set<string>();
  let total = 0;
  for (const { payload } of rows) {
    const action = (payload as { action?: unknown }).action;
    if (typeof action !== "string" || !(action in QUICK_REPLIES) || seen.has(action)) continue;
    seen.add(action);
    total += QUICK_REPLIES[action as QuickReplyAction].delta;
  }
  return total;
}

/**
 * Accept / edit / dismiss a pending suggestion. Accept keeps the customer's quick-reply points on top of the AI
 * score (AI score + boosts, clamped to 0-100). An edit that changes the score saves it as typed (no boost added); an edit that leaves the score alone counts as accept. One transaction; a decided suggestion cannot be decided again. */
export async function decideSuggestion(db: Db, actor: Actor, suggestionId: string, input: AiDecisionInput): Promise<SuggestionRow> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(aiSuggestions).where(eq(aiSuggestions.id, suggestionId)).for("update").limit(1);
    if (!current) throw new AppError("NOT_FOUND", "Suggestion not found");
    if (current.status !== "pending") throw new AppError("CONFLICT", `Suggestion was already ${current.status}`);

    // Accept/edit would set the score of a lead that is already closed: refuse before changing anything.
    // Dismiss is still allowed on a closed lead.
    if (input.action !== "dismiss") {
      const [lead] = await tx.select({ stage: leads.stage }).from(leads).where(eq(leads.id, current.leadId)).for("update").limit(1);
      if (!lead) throw new AppError("NOT_FOUND", "Lead not found");
      if (lead.stage === "won" || lead.stage === "lost") {
        throw new AppError("CONFLICT", `Lead is already ${lead.stage}; the suggestion can only be dismissed`);
      }
    }

    const original = suggestionOutputSchema.parse(current.originalOutput);
    let status: "accepted" | "edited" | "dismissed";
    let final: SuggestionOutput | null = null;
    let boostTotal = 0;
    if (input.action === "dismiss") {
      status = "dismissed";
    } else if (input.action === "accept") {
      status = "accepted";
      boostTotal = await quickReplyBoostTotal(tx, current.leadId);
      final = { ...original, score: Math.max(0, Math.min(100, original.score + boostTotal)) };
    } else {
      if (JSON.stringify(input.finalOutput) === JSON.stringify(original)) {
        throw new AppError("VALIDATION_ERROR", "No changes were made; use accept instead");
      }
      status = "edited";
      final = input.finalOutput;
      // The panel has no score field, so an edit that leaves the score equal to the AI's is a draft-only edit:
      // it still gets the boosts. A score the human changed is saved exactly as typed.
      if (final.score === original.score) {
        boostTotal = await quickReplyBoostTotal(tx, current.leadId);
        final = { ...final, score: Math.max(0, Math.min(100, original.score + boostTotal)) };
      }
    }

    // `status = 'pending'` in the WHERE makes "decide once" a database guarantee, not just the check above.
    const [updated] = await tx
      .update(aiSuggestions)
      .set({
        status,
        finalOutput: final,
        rejectReason: input.action === "dismiss" ? (input.rejectReason ?? null) : null,
        rejectNote: input.action === "dismiss" ? input.rejectNote || null : null,
        decidedBy: actor.id,
        decidedAt: new Date(),
      })
      .where(and(eq(aiSuggestions.id, suggestionId), eq(aiSuggestions.status, "pending")))
      .returning();
    if (!updated) throw new AppError("CONFLICT", "Suggestion was already decided");

    if (final) {
      await tx.update(leads).set({ score: final.score }).where(eq(leads.id, current.leadId));
      await addActivity(tx, {
        leadId: current.leadId,
        actorId: actor.id,
        type: "ai_accepted",
        payload: { suggestionId, status, source: current.source, score: final.score, aiScore: original.score, boostTotal, nextAction: final.nextBestAction.type },
      });
    }
    return updated;
  });
}
