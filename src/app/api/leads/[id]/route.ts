// GET /api/leads/:id (lead + contact + company + timeline) and PATCH (plain fields, never stage).
import { z } from "zod";
import { leadUpdateSchema } from "@/lib/validation/crm";
import { getDb } from "@/server/db/client";
import { ok, readJson, withAuth } from "@/server/http";
import { getLeadDetail, updateLead } from "@/server/services/leads";

const idSchema = z.uuid();

export const GET = withAuth<{ id: string }>(async ({ params, requestId }) =>
  ok(await getLeadDetail(getDb(), idSchema.parse(params.id)), requestId),
);

export const PATCH = withAuth<{ id: string }>(async ({ req, user, params, requestId }) => {
  const input = leadUpdateSchema.parse(await readJson(req));
  return ok(await updateLead(getDb(), user, idSchema.parse(params.id), input), requestId);
});
