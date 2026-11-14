// LINE adapters. `real` calls the LINE Messaging API over fetch (no SDK dependency); `mock` keeps an in-memory
// outbox and needs no credentials. LINE_ADAPTER defaults to mock, so dev, tests and CI never reach LINE.
// Endpoint and payload shapes follow https://developers.line.biz/en/reference/messaging-api/ : check them
// there before the first real run (push, profile, retry key behaviour).
import { randomUUID } from "node:crypto";

export type QuickReplyItem = { label: string; data: string };
export type PushRequest = { to: string; text: string; retryKey: string; quickReplies?: QuickReplyItem[] };
/** `retryable` = worth another attempt (5xx, timeout, network). A 4xx is never retryable. */
export type PushResult =
  | { ok: true; sentMessageId: string | null; duplicate: boolean }
  | { ok: false; retryable: boolean; status: number | null };

export interface LineAdapter {
  readonly name: "real" | "mock";
  push(req: PushRequest): Promise<PushResult>;
  /** Display name, or null when the profile cannot be fetched (the caller uses a placeholder). */
  getProfile(userId: string): Promise<{ displayName: string } | null>;
}

export type MockFailure = "http_500" | "timeout" | "http_400";

/** In-memory stand-in. Like LINE, it accepts a retry key once and reports a repeat as a duplicate. */
export function createMockLineAdapter() {
  const outbox: PushRequest[] = [];
  const attempts: PushRequest[] = [];
  const accepted = new Set<string>();
  const failures: MockFailure[] = [];
  const profiles = new Map<string, string>();
  const state = { profileFails: false };
  const adapter: LineAdapter & {
    outbox: PushRequest[];
    attempts: PushRequest[];
    profileCalls: string[];
    /** The next pushes fail with these, in order, then succeed. */
    failNext(...f: MockFailure[]): void;
    setProfile(userId: string, displayName: string): void;
    failProfiles(v: boolean): void;
  } = {
    name: "mock",
    outbox,
    attempts,
    profileCalls: [],
    failNext: (...f) => void failures.push(...f),
    setProfile: (id, name) => void profiles.set(id, name),
    failProfiles: (v) => void (state.profileFails = v),
    async push(req) {
      attempts.push(req);
      const f = failures.shift();
      if (f === "http_500") return { ok: false, retryable: true, status: 500 };
      if (f === "timeout") return { ok: false, retryable: true, status: null };
      if (f === "http_400") return { ok: false, retryable: false, status: 400 };
      if (accepted.has(req.retryKey)) return { ok: true, sentMessageId: null, duplicate: true };
      accepted.add(req.retryKey);
      outbox.push(req);
      return { ok: true, sentMessageId: `mock-${randomUUID()}`, duplicate: false };
    },
    async getProfile(userId) {
      adapter.profileCalls.push(userId);
      if (state.profileFails) return null;
      return { displayName: profiles.get(userId) ?? "Mock LINE User" };
    },
  };
  return adapter;
}

const LINE_API = "https://api.line.me/v2/bot";
const REQUEST_TIMEOUT_MS = 3_000; // 3 attempts must fit inside a serverless function's time limit

export function createRealLineAdapter(cfg: { accessToken: string; baseUrl?: string; timeoutMs?: number }): LineAdapter {
  const base = cfg.baseUrl ?? LINE_API;
  const timeoutMs = cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const auth = { authorization: `Bearer ${cfg.accessToken}` };
  return {
    name: "real",
    async push(req) {
      try {
        const res = await fetch(`${base}/message/push`, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { ...auth, "content-type": "application/json", "x-line-retry-key": req.retryKey },
          body: JSON.stringify({
            to: req.to,
            messages: [
              {
                type: "text",
                text: req.text,
                ...(req.quickReplies?.length
                  ? {
                      quickReply: {
                        items: req.quickReplies.map((q) => ({
                          type: "action",
                          action: { type: "postback", label: q.label, data: q.data, displayText: q.label },
                        })),
                      },
                    }
                  : {}),
              },
            ],
          }),
        });
        // 409 = LINE already accepted this retry key: the customer has the message, so this is a success.
        if (res.status === 409) return { ok: true, sentMessageId: null, duplicate: true };
        if (!res.ok) return { ok: false, retryable: res.status >= 500, status: res.status };
        const json = (await res.json().catch(() => null)) as { sentMessages?: { id?: string }[] } | null;
        return { ok: true, sentMessageId: json?.sentMessages?.[0]?.id ?? null, duplicate: false };
      } catch {
        return { ok: false, retryable: true, status: null }; // timeout or network error
      }
    },
    async getProfile(userId) {
      try {
        const res = await fetch(`${base}/profile/${encodeURIComponent(userId)}`, { headers: auth, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return null;
        const json = (await res.json()) as { displayName?: unknown };
        return typeof json.displayName === "string" && json.displayName.trim() ? { displayName: json.displayName } : null;
      } catch {
        return null;
      }
    },
  };
}

let devMock: ReturnType<typeof createMockLineAdapter> | undefined;

/** LINE_ADAPTER=real with LINE_CHANNEL_ACCESS_TOKEN → real. Anything else → the mock. Real without a token → null. */
export function lineAdapterFromEnv(env: Record<string, string | undefined> = process.env): LineAdapter | null {
  if (env.LINE_ADAPTER !== "real") return (devMock ??= createMockLineAdapter());
  const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token || token.startsWith("replace-with-")) return null;
  return createRealLineAdapter({ accessToken: token });
}
