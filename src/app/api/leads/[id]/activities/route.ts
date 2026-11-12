// POST /api/leads/:id/activities: add a note or call log to the lead timeline.
import { z } from "zod";
import { activityInputSchema } from "@/lib/validation/crm";
import { getDb } from "@/server/db/client";
import { ok, readJson, withAuth } from "@/server/http";
import { addNote } from "@/server/services/leads";

export const POST = withAuth<{ id: string }>(async ({ req, user, params, requestId }) => {
  const input = activityInputSchema.parse(await readJson(req));
  return ok(await addNote(getDb(), user, z.uuid().parse(params.id), input), requestId, 201);
});
