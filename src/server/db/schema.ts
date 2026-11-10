// Drizzle schema: the 9 CRM tables with their real constraints (CHECK, UNIQUE, FK, indexes).
// Source of truth for migrations in /drizzle; see docs/agent/MASTER_PROMPT.md section 5.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const ROLES = ["admin", "sales"] as const;
export const POLITE_PARTICLES = ["ครับ", "ค่ะ"] as const;
export const LEAD_STAGES = ["new", "qualified", "proposal", "won", "lost"] as const;
export const LEAD_SOURCES = ["website", "manual", "line"] as const;
export const ACTIVITY_TYPES = [
  "note",
  "stage_change",
  "call",
  "ai_accepted",
  "message_sent",
  "message_received",
  "quick_reply",
  "consent",
  "data_erased",
] as const;
export const MESSAGE_DIRECTIONS = ["in", "out"] as const;
export const MESSAGE_STATUSES = ["draft", "approved", "sent", "failed"] as const;
export const AI_SOURCES = ["llm", "fallback"] as const;
export const AI_STATUSES = ["pending", "accepted", "edited", "dismissed"] as const;

export type Role = (typeof ROLES)[number];
export type PoliteParticle = (typeof POLITE_PARTICLES)[number];
export type LeadStage = (typeof LEAD_STAGES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const leadStageEnum = pgEnum("lead_stage", LEAD_STAGES);
export const leadSourceEnum = pgEnum("lead_source", LEAD_SOURCES);
export const activityTypeEnum = pgEnum("activity_type", ACTIVITY_TYPES);

/** Builds `col IN ('a','b')` for CHECK constraints from a const list. */
const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", "));

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ROLES }).notNull().default("sales"),
    politeParticle: text("polite_particle", { enum: POLITE_PARTICLES }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("users_role_check", sql`${t.role} IN (${inList(ROLES)})`),
    check("users_polite_particle_check", sql`${t.politeParticle} IN (${inList(POLITE_PARTICLES)})`),
    check("users_email_lowercase_check", sql`${t.email} = lower(${t.email})`),
  ],
);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    industry: text("industry"),
    website: text("website"),
    size: text("size"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("companies_name_not_blank_check", sql`length(trim(${t.name})) > 0`),
    index("companies_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops")),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    fullName: text("full_name").notNull(),
    email: text("email").unique(),
    phone: text("phone"),
    lineUserId: text("line_user_id").unique(),
    ownerId: uuid("owner_id").references(() => users.id),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("contacts_full_name_not_blank_check", sql`length(trim(${t.fullName})) > 0`),
    index("contacts_full_name_trgm_idx").using("gin", t.fullName.op("gin_trgm_ops")),
    index("contacts_company_id_idx").on(t.companyId),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id),
    title: text("title").notNull(),
    stage: leadStageEnum("stage").notNull().default("new"),
    source: leadSourceEnum("source").notNull(),
    valueThb: integer("value_thb").notNull().default(0),
    score: smallint("score"),
    lostReason: text("lost_reason"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("leads_value_thb_check", sql`${t.valueThb} >= 0`),
    check("leads_score_check", sql`${t.score} IS NULL OR (${t.score} BETWEEN 0 AND 100)`),
    check(
      "leads_lost_reason_check",
      sql`${t.stage} <> 'lost' OR (${t.lostReason} IS NOT NULL AND length(trim(${t.lostReason})) > 0)`,
    ),
    index("leads_stage_owner_idx").on(t.stage, t.ownerId),
    index("leads_contact_id_idx").on(t.contactId),
    index("leads_company_id_idx").on(t.companyId),
  ],
);

/** Append-only audit trail. A DB trigger rejects UPDATE/DELETE (see drizzle/0002_*). */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    actorId: uuid("actor_id").references(() => users.id),
    type: activityTypeEnum("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("activities_lead_created_idx").on(t.leadId, t.createdAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull().default("draft"),
    approvedBy: uuid("approved_by").references(() => users.id),
    lineMessageId: text("line_message_id"),
    retryKey: uuid("retry_key").unique(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("messages_direction_check", sql`${t.direction} IN (${inList(MESSAGE_DIRECTIONS)})`),
    check("messages_status_check", sql`${t.status} IN (${inList(MESSAGE_STATUSES)})`),
    check(
      "messages_sent_out_requires_approval_check",
      sql`NOT (${t.status} = 'sent' AND ${t.direction} = 'out') OR ${t.approvedBy} IS NOT NULL`,
    ),
    check("messages_attempts_check", sql`${t.attempts} >= 0`),
    index("messages_lead_created_idx").on(t.leadId, t.createdAt),
  ],
);

export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    originalOutput: jsonb("original_output").notNull(),
    finalOutput: jsonb("final_output"),
    source: text("source", { enum: AI_SOURCES }).notNull(),
    model: text("model"),
    promptVersion: text("prompt_version").notNull(),
    status: text("status", { enum: AI_STATUSES }).notNull().default("pending"),
    rejectReason: text("reject_reason"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("ai_suggestions_source_check", sql`${t.source} IN (${inList(AI_SOURCES)})`),
    check("ai_suggestions_status_check", sql`${t.status} IN (${inList(AI_STATUSES)})`),
    check(
      "ai_suggestions_decision_check",
      sql`${t.status} = 'pending' OR (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    index("ai_suggestions_lead_created_idx").on(t.leadId, t.createdAt),
  ],
);

export const lineEvents = pgTable("line_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  webhookEventId: text("webhook_event_id").notNull().unique(),
  lineUserId: text("line_user_id"),
  type: text("type").notNull(),
  raw: jsonb("raw").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  createdAt: createdAt(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: updatedAt(),
});
