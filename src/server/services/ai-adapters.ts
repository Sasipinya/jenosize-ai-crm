// LLM adapters. `claude` calls the Anthropic Messages API over fetch (no SDK dependency, pending
// your approval to add one); `mock` is deterministic and needs no key. Tests and CI use the mock.
import { ruleBasedSuggestion } from "../../../skills/crm-copilot/fallback";
import type { AiContext } from "../../../skills/crm-copilot/schema";

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export type AdapterRequest = { system: string; user: string; maxTokens: number; signal: AbortSignal; context: AiContext };
export type AdapterResponse = { text: string; usage: Usage };
export interface LlmAdapter {
  readonly name: "claude" | "mock";
  readonly model: string;
  generate(req: AdapterRequest): Promise<AdapterResponse>;
}

export class AdapterError extends Error {
  constructor(
    readonly kind: "http" | "refusal" | "truncated" | "network" | "not_configured",
    readonly status?: number,
  ) {
    super(kind); // never carries response bodies: they can echo prompt content
    this.name = "AdapterError";
  }
}

export const DEFAULT_MODEL = "claude-haiku-5-5";

// USD per million tokens. Estimates only: check https://platform.claude.com/docs/en/about-claude/pricing
// and override with AI_PRICE_* env vars. Cache read/write use the standard 0.1x / 1.25x ratios.
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };
const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

type Env = Record<string, string | undefined>;

function priceFor(model: string, env: Env = process.env): Price | null {
  const base = PRICES[model];
  const num = (v: string | undefined) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const input = num(env.AI_PRICE_INPUT_PER_MTOK) ?? base?.input;
  const output = num(env.AI_PRICE_OUTPUT_PER_MTOK) ?? base?.output;
  if (input === undefined || output === undefined) return null;
  return {
    input,
    output,
    cacheRead: num(env.AI_PRICE_CACHE_READ_PER_MTOK) ?? base?.cacheRead ?? input * 0.1,
    cacheWrite: num(env.AI_PRICE_CACHE_WRITE_PER_MTOK) ?? base?.cacheWrite ?? input * 1.25,
  };
}

/** Estimated USD for one call, or null when the model's price is unknown. Mock calls cost 0. */
export function estimateCostUsd(adapter: LlmAdapter["name"], model: string, u: Usage, env: Env = process.env): number | null {
  if (adapter === "mock") return 0;
  const p = priceFor(model, env);
  if (!p) return null;
  const usd = (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
  return Math.round(usd * 1e8) / 1e8;
}

const approxTokens = (s: string) => Math.ceil(s.length / 4);

export type MockMode = "ok" | "timeout" | "invalid_json" | "bad_schema" | "http_500" | "http_429" | "unsafe_draft" | "mixed_particles";

/** Deterministic stand-in for the model: rule-based output, flags prompt-injection attempts. */
export function createMockAdapter(opts: { mode?: MockMode } = {}): LlmAdapter & { calls: AdapterRequest[] } {
  const calls: AdapterRequest[] = [];
  return {
    name: "mock",
    model: "mock",
    calls,
    async generate(req) {
      calls.push(req);
      switch (opts.mode ?? "ok") {
        case "timeout":
          return new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(new Error("aborted"))));
        case "http_500":
          throw new AdapterError("http", 500);
        case "http_429":
          throw new AdapterError("http", 429);
        case "invalid_json":
          return { text: "Sure! Here is the plan: {not json", usage: ZERO_USAGE };
        case "bad_schema":
          return { text: JSON.stringify({ summary: "x", score: 250 }), usage: ZERO_USAGE };
        case "mixed_particles": {
          // What the real model did in production: copied the customer's ครับ next to its own ค่ะ/คะ.
          const out = { ...ruleBasedSuggestion(req.context), draftReply: "สวัสดีครับ คุณสมชาย ขอบคุณที่ติดต่อมาค่ะ รบกวนขอทราบรายละเอียดเพิ่มเติมได้ไหมคะ ขอบคุณครับ" };
          return { text: JSON.stringify(out), usage: ZERO_USAGE };
        }
        case "unsafe_draft": {
          // A schema-valid answer whose draft promises a discount and a price: what the guardrail must catch.
          const out = { ...ruleBasedSuggestion(req.context), draftReply: "Sure, we can give you a 50% discount, special price 9,999 baht." };
          return { text: JSON.stringify(out), usage: ZERO_USAGE };
        }
        default: {
          const out = ruleBasedSuggestion(req.context);
          const injected = req.context.events.some((e) => /ignore (all |any )?(previous|prior) instructions|system prompt|ลืมคำสั่ง/i.test(e.text));
          const confident = req.context.events.length >= 2 && req.context.lead.valueThb > 0;
          const text = JSON.stringify({
            ...out,
            summary: injected ? `The customer message contained an unusual request (instructions or a discount demand) that was ignored. ${out.summary}`.slice(0, 600) : out.summary,
            confidence: confident ? "medium" : "low",
          });
          return { text, usage: { ...ZERO_USAGE, inputTokens: approxTokens(req.system + req.user), outputTokens: approxTokens(text) } };
        }
      }
    },
  };
}

export type ClaudeConfig = { apiKey: string; model: string; baseUrl?: string };

/** Anthropic Messages API. Thinking is off so the 800-token cap goes to the JSON, not to reasoning. */
export function createClaudeAdapter(cfg: ClaudeConfig): LlmAdapter {
  const base = cfg.baseUrl ?? "https://api.anthropic.com";
  return {
    name: "claude",
    model: cfg.model,
    async generate(req) {
      let res: Response;
      try {
        res = await fetch(`${base}/v1/messages`, {
          method: "POST",
          signal: req.signal,
          headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: req.maxTokens,
            thinking: { type: "disabled" },
            system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: req.user }],
          }),
        });
      } catch (err) {
        if (req.signal.aborted) throw err; // the orchestrator reports this as a timeout
        throw new AdapterError("network");
      }
      if (!res.ok) throw new AdapterError("http", res.status);
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      };
      if (json.stop_reason === "refusal") throw new AdapterError("refusal");
      if (json.stop_reason === "max_tokens") throw new AdapterError("truncated");
      const text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      const u = json.usage ?? {};
      return {
        text,
        usage: {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}

/** AI_ADAPTER=claude → Claude (needs ANTHROPIC_API_KEY); anything else → mock. Returns null if claude is requested but not configured. */
export function adapterFromEnv(env: Env = process.env): LlmAdapter | null {
  if (env.AI_ADAPTER !== "claude") return createMockAdapter();
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key || key.startsWith("replace-with-")) return null; // unset or the .env.example placeholder
  return createClaudeAdapter({ apiKey: key, model: env.AI_MODEL || DEFAULT_MODEL });
}
