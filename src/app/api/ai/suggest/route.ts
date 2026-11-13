// POST /api/ai/suggest { leadId }: returns the cached suggestion or creates a new pending one.
// Rate limited per user. Never writes anything except the pending ai_suggestions row.
import { aiSuggestInputSchema } from "@/lib/validation/ai";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { ok, readJson, withAuth } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { suggestForLead } from "@/server/services/ai-suggestions";

export const POST = withAuth(async ({ req, user, requestId }) => {
  const { leadId } = aiSuggestInputSchema.parse(await readJson(req));
  if (!rateLimit(`ai-suggest:${user.id}`, 10, 60_000)) throw new AppError("RATE_LIMITED", "Too many AI requests, try again in a minute");
  return ok(await suggestForLead(getDb(), user, leadId), requestId);
});
