// Outbound LINE messages. Nothing is sent until a person approves: the salesperson's click creates the message
// as `approved` (approved_by + a note activity in one transaction), and only then does the push run. AI code
// never calls this file. The retry key is created with the message and reused on every attempt and on Retry.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { SendMessageInput } from "@/lib/validation/line";
import type { Db } from "../../db/client";
import { contacts, leads, messages } from "../../db/schema";
import { AppError } from "../../errors";
import { logger } from "../../logger";
import { addActivity } from "../activities";
import { safeErr } from "../common";
import type { Actor } from "../leads";
import type { LineAdapter } from "./adapter";
import { postbackData, QUICK_REPLIES, QUICK_REPLY_ACTIONS } from "./notice";
import { pushWithRetry } from "./push";

type MessageRow = typeof messages.$inferSelect;
type Deps = { adapter: LineAdapter; sleep?: (ms: number) => Promise<void>; backoffMs?: number[] };

async function lineUserIdOf(db: Pick<Db, "select">, contactId: string): Promise<string> {
  const [c] = await db.select({ lineUserId: contacts.lineUserId, erasedAt: contacts.erasedAt }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!c?.lineUserId || c.erasedAt) throw new AppError("CONFLICT", "This contact has no LINE account to send to");
  return c.lineUserId;
}

/**
 * Delivers an approved message. If anything unexpected throws (DB error, crash in our own code), the row is moved
 * to `failed` so Retry is available. Retry reuses the retry key, so a push that did reach LINE is not delivered twice.
 */
async function deliver(db: Db, deps: Deps, msg: MessageRow): Promise<MessageRow> {
  try {
    return await pushAndRecord(db, deps, msg);
  } catch (err) {
    logger.error({ event: "line_deliver_error", messageId: msg.id, err: safeErr(err) });
    const [failed] = await db
      .update(messages)
      .set({ status: "failed", attempts: msg.attempts + 1 })
      .where(and(eq(messages.id, msg.id), eq(messages.status, "approved")))
      .returning();
    if (failed) return failed;
    throw err;
  }
}

/** Pushes an approved message (3 attempts max) and records the outcome. The draft text is kept when it fails. */
async function pushAndRecord(db: Db, deps: Deps, msg: MessageRow): Promise<MessageRow> {
  const to = await lineUserIdOf(db, msg.contactId);
  const outcome = await pushWithRetry(
    db,
    deps.adapter,
    {
      to,
      text: msg.body,
      retryKey: msg.retryKey!,
      quickReplies: QUICK_REPLY_ACTIONS.map((a) => ({ label: QUICK_REPLIES[a].label, data: postbackData(a, msg.id) })),
    },
    { sleep: deps.sleep, backoffMs: deps.backoffMs },
  );
  logger.info({ event: "line_push", messageId: msg.id, ok: outcome.ok, attempts: outcome.attempts, status: outcome.ok ? 200 : outcome.status });

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(messages)
      .set({
        status: outcome.ok ? "sent" : "failed",
        attempts: msg.attempts + outcome.attempts,
        lineMessageId: outcome.ok ? outcome.sentMessageId : msg.lineMessageId,
      })
      .where(and(eq(messages.id, msg.id), eq(messages.status, "approved")))
      .returning();
    if (!updated) throw new AppError("CONFLICT", "Message state changed while sending");
    if (outcome.ok) {
      await addActivity(tx, { leadId: msg.leadId, actorId: msg.approvedBy, type: "message_sent", payload: { messageId: msg.id, attempts: outcome.attempts } });
    }
    return updated;
  });
}

/** Creates the message as approved by `actor`, then sends it. Returns the stored row (`sent` or `failed`). */
export async function approveAndSend(db: Db, actor: Actor, input: SendMessageInput, deps: Deps): Promise<MessageRow> {
  const approved = await db.transaction(async (tx) => {
    const [lead] = await tx.select({ id: leads.id, contactId: leads.contactId }).from(leads).where(eq(leads.id, input.leadId)).limit(1);
    if (!lead) throw new AppError("NOT_FOUND", "Lead not found");
    await lineUserIdOf(tx, lead.contactId); // refuse before anything is stored
    const [msg] = await tx
      .insert(messages)
      .values({ leadId: lead.id, contactId: lead.contactId, direction: "out", body: input.body, status: "approved", approvedBy: actor.id, retryKey: randomUUID() })
      .returning();
    await addActivity(tx, {
      leadId: lead.id,
      actorId: actor.id,
      type: "note",
      payload: { text: "Approved a message to send on LINE", system: true, messageId: msg!.id },
    });
    return msg!;
  });
  return deliver(db, deps, approved);
}

/** Retry button: only a failed message, re-approved by whoever clicks, with the same retry key. */
export async function retryMessage(db: Db, actor: Actor, messageId: string, deps: Deps): Promise<MessageRow> {
  const reapproved = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(messages).where(eq(messages.id, messageId)).for("update").limit(1);
    if (!current || current.direction !== "out") throw new AppError("NOT_FOUND", "Message not found");
    if (current.status !== "failed") throw new AppError("CONFLICT", `Only a failed message can be retried (this one is ${current.status})`);
    await lineUserIdOf(tx, current.contactId);
    const [row] = await tx
      .update(messages)
      .set({ status: "approved", approvedBy: actor.id })
      .where(and(eq(messages.id, messageId), eq(messages.status, "failed")))
      .returning();
    if (!row) throw new AppError("CONFLICT", "Message was already retried");
    await addActivity(tx, {
      leadId: row.leadId,
      actorId: actor.id,
      type: "note",
      payload: { text: "Approved a retry of a failed LINE message", system: true, messageId: row.id },
    });
    return row;
  });
  return deliver(db, deps, reapproved);
}
