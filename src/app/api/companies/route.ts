// GET /api/companies (search + page) and POST /api/companies (create).
import { companyInputSchema, listQuerySchema } from "@/lib/validation/crm";
import { getDb } from "@/server/db/client";
import { ok, readJson, withAuth } from "@/server/http";
import { createCompany, listCompanies } from "@/server/services/companies";

export const GET = withAuth(async ({ req, requestId }) => {
  const query = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok(await listCompanies(getDb(), query), requestId);
});

export const POST = withAuth(async ({ req, requestId }) => {
  const input = companyInputSchema.parse(await readJson(req));
  return ok(await createCompany(getDb(), input), requestId, 201);
});
