// POST /api/messages: a salesperson approves a LINE message (typed, or an accepted AI draft) and it is sent.
import { sendMessageSchema } from "@/lib/validation/line";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { ok, readJson, withAuth } from "@/server/http";
import { lineAdapterFromEnv } from "@/server/services/line/adapter";
import { approveAndSend } from "@/server/services/line/outbound";

export const maxDuration = 30;

export const POST = withAuth(async ({ req, user, requestId }) => {
  const input = sendMessageSchema.parse(await readJson(req));
  const adapter = lineAdapterFromEnv();
  if (!adapter) throw new AppError("INTERNAL", "LINE is not configured");
  const msg = await approveAndSend(getDb(), user, input, { adapter });
  return ok({ id: msg.id, status: msg.status, attempts: msg.attempts }, requestId, 201);
});
