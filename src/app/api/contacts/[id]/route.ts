// GET /api/contacts/:id and PATCH (full replace of editable fields).
import { z } from "zod";
import { contactInputSchema } from "@/lib/validation/crm";
import { getDb } from "@/server/db/client";
import { ok, readJson, withAuth } from "@/server/http";
import { getContact, updateContact } from "@/server/services/contacts";

export const GET = withAuth<{ id: string }>(async ({ params, requestId }) =>
  ok(await getContact(getDb(), z.uuid().parse(params.id)), requestId),
);

export const PATCH = withAuth<{ id: string }>(async ({ req, params, requestId }) => {
  const input = contactInputSchema.parse(await readJson(req));
  return ok(await updateContact(getDb(), z.uuid().parse(params.id), input), requestId);
});
