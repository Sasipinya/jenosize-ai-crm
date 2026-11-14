// Inbound LINE events: map the LINE user to a contact + lead, store the message and its activity in one
// transaction, send the one fixed privacy notice to a first-time user, and apply Quick Reply postbacks.
// Customer text is stored as data only; nothing here calls the AI or replies with anything but the notice.
import { createHash } from "node:crypto";
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { LineEvent } from "@/lib/validation/line";
import type { Db } from "../../db/client";
import { activities, contacts, leads, messages, users } from "../../db/schema";
import { logger } from "../../logger";
import { addActivity } from "../activities";
import { safeErr } from "../common";
import type { LineAdapter } from "./adapter";
import { parsePostback, privacyNoticeText, PRIVACY_NOTICE_VERSION, QUICK_REPLIES, SCORE_BASELINE } from "./notice";
import { pushWithRetry } from "./push";

type Deps = { adapter: LineAdapter; env?: Record<string, string | undefined>; now?: Date; sleep?: (ms: number) => Promise<void>; backoffMs?: number[] };

/** Same user + same notice → same UUID, so two racing first messages cannot make LINE deliver the notice twice. */
function noticeRetryKey(contactId: string): string {
  const h = createHash("sha256").update(`privacy-notice:${PRIVACY_NOTICE_VERSION}:${contactId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Owner for a new LINE lead: the user with LINE_DEFAULT_OWNER_EMAIL; if that is unset or matches nobody, the
 * first sales user (oldest account). Null only when there is no sales user at all.
 */
async function defaultOwnerId(db: Pick<Db, "select">, env: Record<string, string | undefined>): Promise<string | null> {
  const email = env.LINE_DEFAULT_OWNER_EMAIL?.trim().toLowerCase();
  if (email && !email.startsWith("replace-with-")) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (u) return u.id;
    logger.warn({ event: "line_default_owner_not_found" }); // falls back to the first sales user
  }
  const [first] = await db.select({ id: users.id }).from(users).where(eq(users.role, "sales")).orderBy(users.createdAt, users.id).limit(1);
  return first?.id ?? null;
}

const placeholderName = (userId: string) => `LINE user ${userId.slice(-4)}`;

/** Resolves (or creates) the contact + an open lead, and stores the inbound message. */
async function recordInboundMessage(db: Db, deps: Deps, userId: string, ev: LineEvent) {
  let displayName: string | null = null;
  const [existing] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.lineUserId, userId)).limit(1);
  if (!existing) {
    // Network call kept outside the transaction. A failed lookup is not an error: a placeholder name is used.
    displayName = (await deps.adapter.getProfile(userId))?.displayName.trim().slice(0, 200) || null;
  }
  const name = displayName ?? placeholderName(userId);
  const text = ev.message?.type === "text" ? (ev.message.text ?? "").slice(0, 5000) : "";
  const body = text.trim() ? text : `[${ev.message?.type ?? "message"}]`;

  return db.transaction(async (tx) => {
    if (!existing) await tx.insert(contacts).values({ fullName: name, lineUserId: userId }).onConflictDoNothing({ target: contacts.lineUserId });
    const [contact] = await tx.select().from(contacts).where(eq(contacts.lineUserId, userId)).limit(1);
    if (!contact) throw new Error("contact_not_resolved");

    let [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.contactId, contact.id), notInArray(leads.stage, ["won", "lost"])))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    if (!lead) {
      [lead] = await tx
        .insert(leads)
        .values({ contactId: contact.id, companyId: contact.companyId, ownerId: contact.ownerId ?? (await defaultOwnerId(tx, deps.env ?? process.env)), title: `LINE chat: ${contact.fullName}`.slice(0, 200), source: "line", stage: "new" })
        .returning();
      await addActivity(tx, { leadId: lead!.id, actorId: null, type: "note", payload: { text: "Lead created from LINE", system: true, source: "line" } });
    }
    // A reprocessed event must not store its message twice.
    const lineMessageId = ev.message?.id ?? null;
    const [already] = lineMessageId
      ? await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.contactId, contact.id), eq(messages.direction, "in"), eq(messages.lineMessageId, lineMessageId))).limit(1)
      : [];
    if (!already) {
      const [msg] = await tx
        .insert(messages)
        .values({ leadId: lead!.id, contactId: contact.id, direction: "in", body, status: "sent", lineMessageId })
        .returning();
      await addActivity(tx, { leadId: lead!.id, actorId: null, type: "message_received", payload: { messageId: msg!.id } });
    }
    return { contactId: contact.id, leadId: lead!.id, needsNotice: contact.consentAt === null };
  });
}

/**
 * The first message from a LINE user gets the fixed privacy notice. consent_at and the `consent` activity are
 * written only after LINE accepted the notice, so "consent recorded" always means "the user was told".
 * If the push fails, consent_at stays empty and the next message from that user tries again.
 */
async function sendPrivacyNotice(db: Db, deps: Deps, userId: string, target: { contactId: string; leadId: string }) {
  const text = privacyNoticeText();
  const out = await pushWithRetry(db, deps.adapter, { to: userId, text, retryKey: noticeRetryKey(target.contactId) }, { sleep: deps.sleep, backoffMs: deps.backoffMs });
  if (!out.ok) {
    logger.warn({ event: "line_notice_failed", contactId: target.contactId, attempts: out.attempts, status: out.status });
    return;
  }
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(contacts)
      .set({ consentAt: deps.now ?? new Date() })
      .where(and(eq(contacts.id, target.contactId), isNull(contacts.consentAt)))
      .returning({ id: contacts.id });
    if (!claimed) return; // another event recorded it first
    await addActivity(tx, {
      leadId: target.leadId,
      actorId: null,
      type: "consent",
      payload: { text, system: true, basis: "notice", noticeVersion: PRIVACY_NOTICE_VERSION, channel: "line" },
    });
  });
}

/** Applies a Quick Reply: one `quick_reply` activity per tap; the score changes only on a button's first tap per lead. */
async function applyPostback(db: Db, userId: string, ev: LineEvent) {
  const parsed = ev.postback ? parsePostback(ev.postback.data) : null;
  if (!parsed) return { applied: false as const, reason: "unknown_postback" };

  return db.transaction(async (tx) => {
    const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.lineUserId, userId)).limit(1);
    if (!contact) return { applied: false as const, reason: "unknown_user" };
    // Lock the lead row so two taps arriving together are handled one after the other.
    let lead = parsed.messageId
      ? (await tx.select({ id: leads.id }).from(messages).innerJoin(leads, eq(messages.leadId, leads.id)).where(and(eq(messages.id, parsed.messageId), eq(messages.contactId, contact.id))).limit(1))[0]
      : undefined;
    lead ??= (await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.contactId, contact.id), notInArray(leads.stage, ["won", "lost"]))).orderBy(desc(leads.createdAt)).limit(1))[0];
    if (!lead) return { applied: false as const, reason: "no_lead" };
    const [locked] = await tx.select().from(leads).where(eq(leads.id, lead.id)).for("update").limit(1);

    // Every tap is logged, but a button moves the score only once per lead: re-tapping cannot inflate it.
    const [scored] = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.leadId, lead.id), eq(activities.type, "quick_reply"), sql`${activities.payload}->>'action' = ${parsed.action}`, sql`${activities.payload}->>'scoreChanged' = 'true'`))
      .limit(1);

    const reply = QUICK_REPLIES[parsed.action];
    const before = locked!.score ?? SCORE_BASELINE;
    const after = scored ? (locked!.score ?? before) : Math.max(0, Math.min(100, before + reply.delta));
    if (!scored) await tx.update(leads).set({ score: after }).where(eq(leads.id, lead.id));
    await addActivity(tx, {
      leadId: lead.id,
      actorId: null,
      type: "quick_reply",
      payload: {
        text: `Customer tapped "${reply.label}"${scored ? " again (score unchanged)" : ""}`,
        action: parsed.action,
        scoreChanged: !scored,
        scoreBefore: locked!.score,
        scoreAfter: scored ? locked!.score : after,
      },
    });
    return { applied: true as const, scoreChanged: !scored };
  });
}

/** Handles one stored event. Throws on failure so the caller can record it in line_events.error. */
export async function processLineEvent(db: Db, deps: Deps, ev: LineEvent): Promise<void> {
  const userId = ev.source?.userId;
  if (!userId) return; // e.g. a group event without a user id: nothing to map
  if (ev.type === "message" && ev.message) {
    const r = await recordInboundMessage(db, deps, userId, ev);
    if (r.needsNotice) {
      // The message is already stored. A notice problem must not fail the event (the next message retries the notice).
      await sendPrivacyNotice(db, deps, userId, r).catch((err: unknown) => logger.error({ event: "line_notice_error", contactId: r.contactId, err: safeErr(err) }));
    }
  } else if (ev.type === "postback") {
    const r = await applyPostback(db, userId, ev);
    if (!r.applied) logger.info({ event: "line_postback_ignored", reason: r.reason });
  }
  // follow / unfollow / others: stored in line_events only.
}
