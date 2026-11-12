// Company service: search (trigram-indexed ILIKE, works for Thai), paging, create, update.
import { count, eq, ilike } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies } from "../db/schema";
import { AppError } from "../errors";
import type { CompanyInput } from "@/lib/validation/crm";
import { likePattern, PAGE_SIZE, type Page } from "./common";

export type Company = typeof companies.$inferSelect;

export async function listCompanies(db: Db, opts: { q: string; page: number }): Promise<Page<Company>> {
  const where = opts.q ? ilike(companies.name, likePattern(opts.q)) : undefined;
  const [items, [total]] = await Promise.all([
    db
      .select()
      .from(companies)
      .where(where)
      .orderBy(companies.name, companies.id)
      .limit(PAGE_SIZE)
      .offset((opts.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(companies).where(where),
  ]);
  return { items, total: total?.n ?? 0, page: opts.page, pageSize: PAGE_SIZE };
}

/** Small list for dropdowns (most recently added first would hide data; alphabetical is predictable). */
export const companyOptions = (db: Db) =>
  db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name).limit(500);

export async function getCompany(db: Db, id: string): Promise<Company> {
  const [row] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Company not found");
  return row;
}

export async function createCompany(db: Db, input: CompanyInput): Promise<Company> {
  const [row] = await db.insert(companies).values(input).returning();
  return row!;
}

export async function updateCompany(db: Db, id: string, input: CompanyInput): Promise<Company> {
  const [row] = await db.update(companies).set(input).where(eq(companies.id, id)).returning();
  if (!row) throw new AppError("NOT_FOUND", "Company not found");
  return row;
}
