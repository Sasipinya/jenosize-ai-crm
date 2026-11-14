// One policy for every outbound push: up to 3 attempts with backoff on 5xx / timeout, stop at once on 4xx,
// always the same X-Line-Retry-Key so LINE delivers the message once however many attempts it took.
// Admin switch `simulate_line_down` (app_settings) forces the failure path for the demo.
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { appSettings } from "../../db/schema";
import type { LineAdapter, PushRequest } from "./adapter";

export const MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = [250, 750];

export type PushOutcome =
  | { ok: true; attempts: number; sentMessageId: string | null }
  | { ok: false; attempts: number; status: number | null };

export async function lineSimulatedDown(db: Db): Promise<boolean> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "simulate_line_down")).limit(1);
  return row?.value === true;
}

export async function pushWithRetry(
  db: Db,
  adapter: LineAdapter,
  req: PushRequest,
  opts: { backoffMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<PushOutcome> {
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const down = await lineSimulatedDown(db);

  let status: number | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = down ? ({ ok: false, retryable: true, status: 503 } as const) : await adapter.push(req);
    if (res.ok) return { ok: true, attempts: attempt, sentMessageId: res.sentMessageId };
    status = res.status;
    if (!res.retryable) return { ok: false, attempts: attempt, status }; // 4xx: retrying cannot help
    if (attempt < MAX_ATTEMPTS) await sleep(backoff[attempt - 1] ?? backoff.at(-1) ?? 0);
  }
  return { ok: false, attempts: MAX_ATTEMPTS, status };
}
