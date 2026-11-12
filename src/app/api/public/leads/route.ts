// POST /api/public/leads: website form intake. Public, so it is guarded by an API key
// (x-api-key, constant-time compare), a per-IP rate limit and a honeypot field.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { websiteLeadSchema } from "@/lib/validation/crm";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { ok, readJson, toErrorResponse } from "@/server/http";
import { logger } from "@/server/logger";
import { rateLimit } from "@/server/rate-limit";
import { createWebsiteLead } from "@/server/services/leads";

function keyMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const requestId = randomUUID();
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!rateLimit(`public-leads:${ip}`, 5, 60_000)) throw new AppError("RATE_LIMITED", "Too many requests, try again later");
    if (!keyMatches(req.headers.get("x-api-key"), process.env.LEAD_INTAKE_API_KEY)) {
      throw new AppError("UNAUTHORIZED", "Invalid API key");
    }
    const input = websiteLeadSchema.parse(await readJson(req));
    const result = await createWebsiteLead(getDb(), input);
    logger.info({ event: "public_lead", requestId, leadId: result.leadId });
    return ok({ accepted: true }, requestId, 201);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
