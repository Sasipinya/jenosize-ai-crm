// POST /api/ai/suggestions/:id/decision: accept, edit or dismiss. The only way an AI suggestion changes data.
import { z } from "zod";
import { aiDecisionSchema } from "@/lib/validation/ai";
import { getDb } from "@/server/db/client";
import { ok, readJson, withAuth } from "@/server/http";
import { decideSuggestion } from "@/server/services/ai-suggestions";

export const POST = withAuth<{ id: string }>(async ({ req, user, params, requestId }) => {
  const input = aiDecisionSchema.parse(await readJson(req));
  return ok(await decideSuggestion(getDb(), user, z.uuid().parse(params.id), input), requestId);
});
