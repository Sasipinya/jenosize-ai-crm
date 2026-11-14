// POST /api/messages/:id/retry: the Retry button for a failed LINE message. Same retry key, so no double delivery.
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { ok, withAuth } from "@/server/http";
import { lineAdapterFromEnv } from "@/server/services/line/adapter";
import { retryMessage } from "@/server/services/line/outbound";

export const maxDuration = 30;

export const POST = withAuth<{ id: string }>(async ({ user, params, requestId }) => {
  const adapter = lineAdapterFromEnv();
  if (!adapter) throw new AppError("INTERNAL", "LINE is not configured");
  const msg = await retryMessage(getDb(), user, z.uuid().parse(params.id), { adapter });
  return ok({ id: msg.id, status: msg.status, attempts: msg.attempts }, requestId);
});
