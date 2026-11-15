// One definition of "which quick-reply taps counted toward a lead's score", shared by the postback handler
// (inbound.ts: does this tap move the score?) and by Accept (ai-suggestions.ts: how many points to keep on top
// of the AI score?). Two copies of this rule is how a boost gets counted twice.
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { activities } from "../../db/schema";
import { QUICK_REPLIES, QUICK_REPLY_ACTIONS, type QuickReplyAction } from "./notice";

export type QuickReplyPayload = Record<string, unknown>;

const isAction = (v: unknown): v is QuickReplyAction => typeof v === "string" && (QUICK_REPLY_ACTIONS as readonly string[]).includes(v);

/**
 * Each button counts ONCE per lead, and only a tap that actually changed the score (`scoreChanged: true`): a repeat
 * tap is logged with `scoreChanged: false` and adds nothing. A button is worth its QUICK_REPLIES delta, whatever the score was
 * when it was tapped.
 */
export function scoredQuickReplies(payloads: QuickReplyPayload[]): Map<QuickReplyAction, number> {
  const out = new Map<QuickReplyAction, number>();
  for (const p of payloads) {
    if (p.scoreChanged !== true || !isAction(p.action) || out.has(p.action)) continue;
    out.set(p.action, QUICK_REPLIES[p.action].delta);
  }
  return out;
}

/** Points the customer earned from quick replies on this lead (can be negative): the table value of each counted button. The caller clamps the final score to 0-100. */
export const quickReplyBoost = (payloads: QuickReplyPayload[]): number => [...scoredQuickReplies(payloads).values()].reduce((a, b) => a + b, 0);

/** The lead's quick_reply activity payloads, oldest first. Call inside the transaction that holds the lead lock. */
export async function quickReplyPayloads(tx: Pick<Db, "select">, leadId: string): Promise<QuickReplyPayload[]> {
  const rows = await tx
    .select({ payload: activities.payload })
    .from(activities)
    .where(and(eq(activities.leadId, leadId), eq(activities.type, "quick_reply")))
    .orderBy(asc(activities.createdAt));
  return rows.map((r) => r.payload as QuickReplyPayload);
}
