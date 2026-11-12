// Lead service: list/search/filter, create, edit, the single stage-change path, notes and the
// website intake. Every state change writes its `activities` row in the same transaction.
import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  activities,
  companies,
  contacts,
  leads,
  messages,
  users,
  type LeadStage,
} from "../db/schema";
import { AppError } from "../errors";
import type {
  ActivityInput,
  LeadCreateInput,
  LeadUpdateInput,
  StageChangeInput,
  WebsiteLeadInput,
} from "@/lib/validation/crm";
import { addActivity } from "./activities";
import { likePattern, PAGE_SIZE, type Page } from "./common";

export type Actor = { id: string; role: "admin" | "sales" };
const TERMINAL: LeadStage[] = ["won", "lost"];

export type LeadRow = {
  id: string;
  title: string;
  stage: LeadStage;
  source: "website" | "manual" | "line";
  valueThb: number;
  score: number | null;
  stageChangedAt: Date;
  contactId: string;
  contactName: string;
  companyId: string | null;
  companyName: string | null;
  ownerId: string | null;
  ownerName: string | null;
};

export type LeadFilters = { q: string; page: number; stage?: LeadStage; source?: LeadRow["source"]; owner?: string };

export async function listLeads(db: Db, f: LeadFilters): Promise<Page<LeadRow>> {
  const conds: (SQL | undefined)[] = [
    f.stage ? eq(leads.stage, f.stage) : undefined,
    f.source ? eq(leads.source, f.source) : undefined,
    f.owner ? eq(leads.ownerId, f.owner) : undefined,
  ];
  if (f.q) {
    const like = likePattern(f.q);
    conds.push(or(ilike(leads.title, like), ilike(contacts.fullName, like), ilike(companies.name, like)));
  }
  const where = and(...conds);

  const base = () =>
    db
      .select({
        id: leads.id,
        title: leads.title,
        stage: leads.stage,
        source: leads.source,
        valueThb: leads.valueThb,
        score: leads.score,
        stageChangedAt: leads.stageChangedAt,
        contactId: leads.contactId,
        contactName: contacts.fullName,
        companyId: leads.companyId,
        companyName: companies.name,
        ownerId: leads.ownerId,
        ownerName: users.name,
      })
      .from(leads)
      .innerJoin(contacts, eq(leads.contactId, contacts.id))
      .leftJoin(companies, eq(leads.companyId, companies.id))
      .leftJoin(users, eq(leads.ownerId, users.id));

  const [items, [total]] = await Promise.all([
    base()
      .where(where)
      .orderBy(desc(leads.createdAt), leads.id)
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(leads)
      .innerJoin(contacts, eq(leads.contactId, contacts.id))
      .leftJoin(companies, eq(leads.companyId, companies.id))
      .where(where),
  ]);
  return { items, total: total?.n ?? 0, page: f.page, pageSize: PAGE_SIZE };
}

export type TimelineItem =
  | { kind: "activity"; id: string; at: Date; type: string; actorName: string | null; payload: Record<string, unknown> }
  | { kind: "message"; id: string; at: Date; direction: string; status: string; body: string };

export async function getLeadDetail(db: Db, id: string) {
  const [row] = await db
    .select({ lead: leads, contact: contacts, company: companies, ownerName: users.name })
    .from(leads)
    .innerJoin(contacts, eq(leads.contactId, contacts.id))
    .leftJoin(companies, eq(leads.companyId, companies.id))
    .leftJoin(users, eq(leads.ownerId, users.id))
    .where(eq(leads.id, id))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Lead not found");

  const [acts, msgs] = await Promise.all([
    db
      .select({ a: activities, actorName: users.name })
      .from(activities)
      .leftJoin(users, eq(activities.actorId, users.id))
      .where(eq(activities.leadId, id)),
    db.select().from(messages).where(eq(messages.leadId, id)),
  ]);

  const timeline: TimelineItem[] = [
    ...acts.map((r): TimelineItem => ({
      kind: "activity",
      id: r.a.id,
      at: r.a.createdAt,
      type: r.a.type,
      actorName: r.actorName,
      payload: r.a.payload,
    })),
    ...msgs.map((m): TimelineItem => ({
      kind: "message",
      id: m.id,
      at: m.createdAt,
      direction: m.direction,
      status: m.status,
      body: m.body,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return { lead: row.lead, contact: row.contact, company: row.company, ownerName: row.ownerName, timeline };
}

export async function createLead(db: Db, actor: Actor, input: LeadCreateInput) {
  return db.transaction(async (tx) => {
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, input.contactId)).limit(1);
    if (!contact) throw new AppError("VALIDATION_ERROR", "Contact does not exist");
    const [lead] = await tx
      .insert(leads)
      .values({
        title: input.title,
        contactId: input.contactId,
        companyId: input.companyId ?? contact.companyId,
        ownerId: input.ownerId ?? actor.id,
        valueThb: input.valueThb,
        source: "manual",
      })
      .returning();
    await addActivity(tx, { leadId: lead!.id, actorId: actor.id, type: "note", payload: { text: "Lead created", system: true, source: "manual" } });
    return lead!;
  });
}

/** Edits plain fields. Stage is deliberately not editable here: use changeStage. */
export async function updateLead(db: Db, actor: Actor, id: string, input: LeadUpdateInput) {
  return db.transaction(async (tx) => {
    const [lead] = await tx.update(leads).set(input).where(eq(leads.id, id)).returning();
    if (!lead) throw new AppError("NOT_FOUND", "Lead not found");
    await addActivity(tx, {
      leadId: id,
      actorId: actor.id,
      type: "note",
      payload: { text: "Lead details updated", system: true, fields: Object.keys(input) },
    });
    return lead;
  });
}

/**
 * The only way to change a stage. Locks the row, enforces: lost needs a reason; won/lost are
 * terminal and only an admin may reopen; writes the stage_change activity in the same transaction.
 */
export async function changeStage(db: Db, actor: Actor, id: string, input: StageChangeInput) {
  const lostReason = input.stage === "lost" ? input.lostReason : null;
  if (input.stage === "lost" && !lostReason) {
    throw new AppError("VALIDATION_ERROR", "A reason is required when marking a lead as lost");
  }
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(leads).where(eq(leads.id, id)).for("update").limit(1);
    if (!current) throw new AppError("NOT_FOUND", "Lead not found");
    if (current.stage === input.stage) throw new AppError("VALIDATION_ERROR", `Lead is already ${input.stage}`);
    if (TERMINAL.includes(current.stage) && actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "Only an admin can reopen a won or lost lead");
    }
    const [lead] = await tx
      .update(leads)
      .set({ stage: input.stage, lostReason, stageChangedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    await addActivity(tx, {
      leadId: id,
      actorId: actor.id,
      type: "stage_change",
      payload: { from: current.stage, to: input.stage, ...(lostReason ? { lostReason } : {}) },
    });
    return lead!;
  });
}

export async function addNote(db: Db, actor: Actor, id: string, input: ActivityInput) {
  return db.transaction(async (tx) => {
    const [lead] = await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, id)).limit(1);
    if (!lead) throw new AppError("NOT_FOUND", "Lead not found");
    return addActivity(tx, { leadId: id, actorId: actor.id, type: input.type, payload: { text: input.text } });
  });
}

/**
 * Website intake (R8). Honeypot hits are acknowledged but dropped. Reuses the contact when the
 * email already exists. The visitor's message and company name go into the first activity.
 */
export async function createWebsiteLead(db: Db, input: WebsiteLeadInput): Promise<{ accepted: true; leadId?: string }> {
  if (input.companyWebsite) return { accepted: true };
  return db.transaction(async (tx) => {
    // onConflictDoNothing + re-select: two simultaneous submissions with a new email both succeed.
    await tx
      .insert(contacts)
      .values({ fullName: input.fullName, email: input.email, phone: input.phone })
      .onConflictDoNothing({ target: contacts.email });
    const [contact] = await tx.select().from(contacts).where(eq(contacts.email, input.email)).limit(1);
    if (!contact) throw new AppError("INTERNAL", "Could not resolve contact");
    const [lead] = await tx
      .insert(leads)
      .values({
        title: `Website enquiry: ${input.fullName}`.slice(0, 200),
        contactId: contact.id,
        companyId: contact.companyId,
        source: "website",
      })
      .returning();
    await addActivity(tx, {
      leadId: lead!.id,
      actorId: null,
      type: "note",
      payload: { text: input.message, source: "website", companyName: input.companyName, system: true },
    });
    return { accepted: true as const, leadId: lead!.id };
  });
}

export const salesUsers = (db: Db) =>
  db.select({ id: users.id, name: users.name }).from(users).orderBy(users.name);
