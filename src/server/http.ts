// Route-handler wrapper: requestId, session check, Zod/AppError → { error: { code, message } }.
// Never leaks stack traces; unexpected errors are logged (pino, redacted) and returned as INTERNAL.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSessionUser } from "./auth";
import { AppError } from "./errors";
import { logger } from "./logger";
import { pgCode, safeErr } from "./services/common";

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
export type Ctx<P> = { req: Request; user: SessionUser; params: P; requestId: string };

function errorResponse(status: number, code: string, message: string, requestId: string) {
  return NextResponse.json({ error: { code, message }, requestId }, { status });
}

/** Turns any thrown value into the standard error response. Exported for public routes. */
export function toErrorResponse(err: unknown, requestId: string) {
  if (err instanceof AppError) return errorResponse(err.status, err.code, err.message, requestId);
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return errorResponse(400, "VALIDATION_ERROR", message, requestId);
  }
  if (pgCode(err) === "23503") return errorResponse(400, "VALIDATION_ERROR", "A referenced record does not exist", requestId);
  logger.error({ event: "unhandled_error", requestId, err: safeErr(err) });
  return errorResponse(500, "INTERNAL", "Something went wrong", requestId);
}

export function ok<T>(data: T, requestId: string, status = 200) {
  return NextResponse.json({ data, requestId }, { status });
}

/** Parses a JSON body, rejecting malformed JSON as a validation error. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Body must be valid JSON");
  }
}

/** Wraps an authenticated handler. `params` is awaited (Next 16 passes a Promise). */
export function withAuth<P = Record<string, never>>(
  handler: (ctx: Ctx<P>) => Promise<Response>,
): (req: Request, route: { params: Promise<P> }) => Promise<Response> {
  return async (req, route) => {
    const requestId = randomUUID();
    const started = Date.now();
    try {
      const user = await getSessionUser();
      if (!user) throw new AppError("UNAUTHORIZED", "Login required");
      const res = await handler({ req, user, params: await route.params, requestId });
      logger.info({ event: "api_request", requestId, userId: user.id, method: req.method, status: res.status, durationMs: Date.now() - started });
      return res;
    } catch (err) {
      return toErrorResponse(err, requestId);
    }
  };
}
