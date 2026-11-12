// Zod schemas shared by route handlers, server actions and forms for leads, contacts and companies.
import { z } from "zod";
import { LEAD_SOURCES, LEAD_STAGES } from "@/server/db/schema";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish()
    .transform((v) => v ?? null);

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .transform((v) => (v === "" ? null : v))
  .nullish()
  .transform((v) => v ?? null)
  .pipe(z.email().nullable());

const optionalUuid = z
  .string()
  .transform((v) => (v === "" ? null : v))
  .nullish()
  .transform((v) => v ?? null)
  .pipe(z.uuid().nullable());

const optionalWebsite = optionalText(200).refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), {
  message: "Website must start with http:// or https://",
});

/** Blank form value: `omit` (or missing) → 0 for create; `reject` → validation error on edit, never a silent 0. */
const money = (blank: "omit" | "reject") =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? (blank === "omit" ? 0 : v === undefined ? v : Number.NaN) : v),
    z.coerce.number().int().min(0).max(1_000_000_000),
  );

const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max);
const page = z.coerce.number().int().min(1).max(10_000).default(1);

export const companyInputSchema = z.object({
  name: requiredText(200),
  industry: optionalText(100),
  website: optionalWebsite,
  size: optionalText(50),
});

export const contactInputSchema = z.object({
  fullName: requiredText(200),
  email: optionalEmail,
  phone: optionalText(30),
  companyId: optionalUuid,
  ownerId: optionalUuid,
});

export const leadCreateSchema = z.object({
  title: requiredText(200),
  contactId: z.uuid(),
  companyId: optionalUuid,
  ownerId: optionalUuid,
  valueThb: money("omit"),
});

export const leadUpdateSchema = z
  .object({
    title: requiredText(200),
    companyId: optionalUuid,
    ownerId: optionalUuid,
    valueThb: money("reject"),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export const stageChangeSchema = z.object({
  stage: z.enum(LEAD_STAGES),
  lostReason: optionalText(500),
});

export const activityInputSchema = z.object({
  type: z.enum(["note", "call"]),
  text: requiredText(2000),
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(""),
  page,
});

export const leadListQuerySchema = listQuerySchema.extend({
  stage: z.enum(LEAD_STAGES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  owner: z.uuid().optional(),
});

/** Public website form. `companyWebsite` is the honeypot: real visitors never see or fill it. */
export const websiteLeadSchema = z.object({
  fullName: requiredText(200),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  phone: optionalText(30),
  companyName: optionalText(200),
  message: requiredText(2000),
  companyWebsite: z.string().max(500).optional(),
});

export type CompanyInput = z.infer<typeof companyInputSchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
export type StageChangeInput = z.infer<typeof stageChangeSchema>;
export type ActivityInput = z.infer<typeof activityInputSchema>;
export type WebsiteLeadInput = z.infer<typeof websiteLeadSchema>;
