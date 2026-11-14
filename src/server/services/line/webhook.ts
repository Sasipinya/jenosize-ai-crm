// LINE webhook entry. Order matters: verify the signature on the RAW body first (nothing is stored on a
// mismatch), then persist each event with INSERT ... ON CONFLICT DO NOTHING on webhook_event_id, answer fast,
// and process the new events afterwards through `schedule` (Next's after() in the route, inline in tests).
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { lineWebhookSchema, type LineEvent } from "@/lib/validation/line";
import type { Db } from "../../db/client";
import { lineEvents } from "../../db/schema";
import { AppError } from "../../errors";
import { logger } from "../../logger";
import { safeErr } from "../common";
import type { LineAdapter } from "./adapter";
import { processLineEvent } from "./inbound";
import { verifyLineSignature } from "./signature";

export type WebhookInput = {
  rawBody: string;
  signature: string | null;
  secret: string | undefined;
  adapter: LineAdapter;
  env?: Record<string, string | undefined>;
  schedule: (task: () => Promise<void>) => void;
  sleep?: (ms: number) => Promise<void>;
  backoffMs?: number[];
};

export async function handleLineWebhook(db: Db, input: WebhookInput): Promise<{ received: number; fresh: number }> {
  if (!verifyLineSignature(input.secret, input.rawBody, input.signature)) {
    logger.warn({ event: "line_bad_signature", configured: Boolean(input.secret) });
    throw new AppError("UNAUTHORIZED", "Invalid signature");
  }
  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Body must be valid JSON");
  }
  const { events } = lineWebhookSchema.parse(json);

  const toProcess: { rowId: string; event: LineEvent }[] = [];
  for (const event of events) {
    const [inserted] = await db
      .insert(lineEvents)
      .values({ webhookEventId: event.webhookEventId, lineUserId: event.source?.userId ?? null, type: event.type, raw: event })
      .onConflictDoNothing({ target: lineEvents.webhookEventId })
      .returning({ id: lineEvents.id });
    if (inserted) {
      toProcess.push({ rowId: inserted.id, event });
      continue;
    }
    // Duplicate (LINE redelivery or a double post): skipped, unless the first attempt failed. Claiming the
    // failed row (error → null) lets exactly one redelivery retry it.
    const [claimed] = await db
      .update(lineEvents)
      .set({ error: null })
      .where(sqlFailed(event.webhookEventId))
      .returning({ id: lineEvents.id });
    if (claimed) toProcess.push({ rowId: claimed.id, event });
  }

  if (toProcess.length) {
    input.schedule(async () => {
      for (const { rowId, event } of toProcess) {
        try {
          await processLineEvent(db, { adapter: input.adapter, env: input.env, sleep: input.sleep, backoffMs: input.backoffMs }, event);
          await db.update(lineEvents).set({ processedAt: new Date(), error: null }).where(eq(lineEvents.id, rowId));
        } catch (err) {
          const e = safeErr(err);
          logger.error({ event: "line_event_failed", eventRowId: rowId, err: e });
          await db.update(lineEvents).set({ error: `${e.name}${e.code ? ` ${e.code}` : ""}` }).where(eq(lineEvents.id, rowId));
        }
      }
    });
  }
  return { received: events.length, fresh: toProcess.length };
}

const sqlFailed = (webhookEventId: string) =>
  and(eq(lineEvents.webhookEventId, webhookEventId), isNull(lineEvents.processedAt), isNotNull(lineEvents.error));
