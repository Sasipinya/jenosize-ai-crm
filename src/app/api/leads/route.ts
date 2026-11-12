// GET /api/leads (search, filter, page) and POST /api/leads (manual create). Thin: logic is in the service.
import { leadCreateSchema, leadListQuerySchema } from "@/lib/validation/crm";
import { getDb } from "@/server/db/client";
import { ok, readJson, withAuth } from "@/server/http";
import { createLead, listLeads } from "@/server/services/leads";

export const GET = withAuth(async ({ req, requestId }) => {
  const query = leadListQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok(await listLeads(getDb(), query), requestId);
});

export const POST = withAuth(async ({ req, user, requestId }) => {
  const input = leadCreateSchema.parse(await readJson(req));
  return ok(await createLead(getDb(), user, input), requestId, 201);
});
