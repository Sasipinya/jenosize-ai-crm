// Contact service: search by name/email, paging, create, update. Erased contacts are hidden from edit.
import { count, eq, ilike, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, contacts } from "../db/schema";
import { AppError } from "../errors";
import type { ContactInput } from "@/lib/validation/crm";
import { isUniqueViolation, likePattern, PAGE_SIZE, type Page } from "./common";

export type Contact = typeof contacts.$inferSelect;
export type ContactRow = Contact & { companyName: string | null };

export async function listContacts(db: Db, opts: { q: string; page: number }): Promise<Page<ContactRow>> {
  const like = opts.q ? likePattern(opts.q) : null;
  const where = like ? or(ilike(contacts.fullName, like), ilike(contacts.email, like)) : undefined;
  const [items, [total]] = await Promise.all([
    db
      .select({ contact: contacts, companyName: companies.name })
      .from(contacts)
      .leftJoin(companies, eq(contacts.companyId, companies.id))
      .where(where)
      .orderBy(contacts.fullName, contacts.id)
      .limit(PAGE_SIZE)
      .offset((opts.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(contacts).where(where),
  ]);
  return {
    items: items.map((r) => ({ ...r.contact, companyName: r.companyName })),
    total: total?.n ?? 0,
    page: opts.page,
    pageSize: PAGE_SIZE,
  };
}

/** Name search for the "pick a contact" field in the new-lead form. */
export async function searchContacts(db: Db, q: string, limit = 10) {
  const where = q ? ilike(contacts.fullName, likePattern(q)) : undefined;
  return db
    .select({ id: contacts.id, fullName: contacts.fullName, companyName: companies.name })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .where(where)
    .orderBy(contacts.fullName)
    .limit(limit);
}

export async function getContactOption(db: Db, id: string) {
  const [row] = await db
    .select({ id: contacts.id, fullName: contacts.fullName, companyName: companies.name })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .where(eq(contacts.id, id))
    .limit(1);
  return row ?? null;
}

export async function getContact(db: Db, id: string): Promise<Contact> {
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Contact not found");
  return row;
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("CONFLICT", "A contact with this email already exists");
    throw err;
  }
}

export const createContact = (db: Db, input: ContactInput): Promise<Contact> =>
  guarded(async () => {
    const [row] = await db.insert(contacts).values(input).returning();
    return row!;
  });

export const updateContact = (db: Db, id: string, input: ContactInput): Promise<Contact> =>
  guarded(async () => {
    const [current] = await db.select({ erasedAt: contacts.erasedAt }).from(contacts).where(eq(contacts.id, id)).limit(1);
    if (!current) throw new AppError("NOT_FOUND", "Contact not found");
    if (current.erasedAt) throw new AppError("CONFLICT", "This contact's data was erased and cannot be edited");
    const [row] = await db.update(contacts).set(input).where(eq(contacts.id, id)).returning();
    return row!;
  });
