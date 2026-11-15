// Health probe for uptime checks: DB reachable, which AI/LINE adapters are selected, git version.
// Public, so it exposes no secret, no PII and no error text: only adapter names, the model id and booleans.
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { appSettings } from "../db/schema";
import { logger } from "../logger";
import { safeErr } from "./common";
import { DEFAULT_MODEL } from "./ai-adapters";

type Env = Record<string, string | undefined>;
const present = (v: string | undefined) => !!v?.trim() && !v.trim().startsWith("replace-with-");
const DB_TIMEOUT_MS = 3000;

export type Health = {
  status: "ok" | "degraded" | "error";
  db: "ok" | "error";
  ai: { adapter: "claude" | "mock"; model: string; configured: boolean; simulatedDown: boolean | null };
  line: { adapter: "real" | "mock"; configured: boolean };
  version: string | null;
};

/** `getDb` is lazy so a missing DATABASE_URL becomes `db: "error"` instead of a thrown 500. */
export async function checkHealth(getDb: () => Db, env: Env = process.env): Promise<{ httpStatus: 200 | 503; body: Health }> {
  const claude = env.AI_ADAPTER === "claude";
  const realLine = env.LINE_ADAPTER === "real";
  const ai = {
    adapter: (claude ? "claude" : "mock") as "claude" | "mock",
    model: claude ? env.AI_MODEL || DEFAULT_MODEL : "mock",
    configured: claude ? present(env.ANTHROPIC_API_KEY) : true,
    simulatedDown: null as boolean | null,
  };
  const line = { adapter: (realLine ? "real" : "mock") as "real" | "mock", configured: realLine ? present(env.LINE_CHANNEL_ACCESS_TOKEN) && present(env.LINE_CHANNEL_SECRET) : true };
  const version = env.VERCEL_GIT_COMMIT_SHA ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null;

  let dbOk = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const db = getDb();
    const queries = (async () => {
      await db.execute(sql`select 1`);
      const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "simulate_ai_down")).limit(1);
      return row?.value === true;
    })();
    ai.simulatedDown = await Promise.race([
      queries,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("db timeout")), DB_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    dbOk = false;
    logger.warn({ event: "health_db_error", err: safeErr(err) });
  } finally {
    clearTimeout(timer);
  }

  const status = !dbOk ? "error" : ai.configured && line.configured ? "ok" : "degraded";
  return { httpStatus: dbOk ? 200 : 503, body: { status, db: dbOk ? "ok" : "error", ai, line, version } };
}
