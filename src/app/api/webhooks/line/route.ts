// POST /api/webhooks/line: public (no session); authenticated by the x-line-signature HMAC instead.
// The body is read as raw text because the signature covers the exact bytes LINE sent.
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { ok, toErrorResponse } from "@/server/http";
import { logger } from "@/server/logger";
import { lineAdapterFromEnv } from "@/server/services/line/adapter";
import { handleLineWebhook } from "@/server/services/line/webhook";

export const maxDuration = 30;

export async function POST(req: Request) {
  const requestId = randomUUID();
  try {
    const adapter = lineAdapterFromEnv();
    if (!adapter) throw new AppError("INTERNAL", "LINE is not configured");
    const rawBody = await req.text();
    const result = await handleLineWebhook(getDb(), {
      rawBody,
      signature: req.headers.get("x-line-signature"),
      secret: process.env.LINE_CHANNEL_SECRET,
      adapter,
      schedule: (task) => after(task),
    });
    logger.info({ event: "line_webhook", requestId, ...result });
    return ok({ received: result.received }, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
