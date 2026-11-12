// GET /api/contacts (search + page) and POST /api/contacts (create).
import { contactInputSchema, listQuerySchema } from "@/lib/validation/crm";
import { getDb } from "@/server/db/client";
import { ok, readJson, withAuth } from "@/server/http";
import { createContact, listContacts } from "@/server/services/contacts";

export const GET = withAuth(async ({ req, requestId }) => {
  const query = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok(await listContacts(getDb(), query), requestId);
});

export const POST = withAuth(async ({ req, requestId }) => {
  const input = contactInputSchema.parse(await readJson(req));
  return ok(await createContact(getDb(), input), requestId, 201);
});
