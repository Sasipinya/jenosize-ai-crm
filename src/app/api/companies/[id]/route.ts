// GET /api/companies/:id and PATCH (full replace of editable fields).
import { z } from "zod";
import { companyInputSchema } from "@/lib/validation/crm";
import { getDb } from "@/server/db/client";
import { ok, readJson, withAuth } from "@/server/http";
import { getCompany, updateCompany } from "@/server/services/companies";

export const GET = withAuth<{ id: string }>(async ({ params, requestId }) =>
  ok(await getCompany(getDb(), z.uuid().parse(params.id)), requestId),
);

export const PATCH = withAuth<{ id: string }>(async ({ req, params, requestId }) => {
  const input = companyInputSchema.parse(await readJson(req));
  return ok(await updateCompany(getDb(), z.uuid().parse(params.id), input), requestId);
});
