// Orchestrates one suggestion: prompt → adapter (15 s timeout, 1 retry) → JSON → Zod → guardrails.
// Any failure ends in the rule-based fallback, so the caller always gets a schema-valid result.
import { neutralReply, ruleBasedSuggestion } from "../../../skills/crm-copilot/fallback";
import { genderedWording, nonThaiField, unsupportedOffer } from "../../../skills/crm-copilot/guardrails";
import { normalizeParticles } from "../../../skills/crm-copilot/particles";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "../../../skills/crm-copilot/prompt";
import { suggestionOutputSchema, type AiContext, type SuggestionOutput } from "../../../skills/crm-copilot/schema";
import { AdapterError, estimateCostUsd, ZERO_USAGE, type LlmAdapter, type Usage } from "./ai-adapters";

export const TIMEOUT_MS = 15_000;
export const MAX_TOKENS = 800;
const MAX_ATTEMPTS = 2; // first try + 1 retry

export type FailureReason = "timeout" | "http_429" | "http_5xx" | "http_4xx" | "network" | "refusal" | "truncated" | "invalid_json" | "schema" | "language" | "gendered" | "not_configured" | "simulated";

export type GenerateResult = {
  output: SuggestionOutput;
  source: "llm" | "fallback";
  model: string | null;
  promptVersion: string;
  usage: Usage;
  estimatedCostUsd: number | null;
  attempts: number;
  durationMs: number;
  failure?: FailureReason;
  /** The model's draft broke a guardrail and was replaced by a neutral reply. */
  draftReplaced: boolean;
  /** The draft used the other polite particle (e.g. the customer's ครับ) and was rewritten to the owner's. */
  particleNormalised: boolean;
  /** The model's parsed answer BEFORE guardrails (null for the rule-based fallback). For the eval report; never stored in the DB. */
  rawOutput: SuggestionOutput | null;
};

/** Adds a reason without breaking the schema limit of 5: when full, the last reason makes room. */
const withReason = (reasons: string[], reason: string) => (reasons.length >= 5 ? [...reasons.slice(0, 4), reason] : [...reasons, reason]);

/**
 * Code-enforced guardrails, applied to every output (LLM or fallback):
 * 1. won/lost leads get no draft and "wait" unless the customer wrote last;
 * 2. a draft that mentions a discount, promotion or percentage, or states a price that is not the lead
 *    value or a figure in our outbound messages, is replaced by a neutral reply and a reason is added
 *    (see skills/crm-copilot/guardrails.ts);
 * 3. (in generateSuggestion, not here) summary/reasons/next action/missing info must be Thai and no gendered wording
 *    is allowed: a violation is retried once, then replaced by the Thai rule-based fallback;
 * 4. the draft speaks with the lead owner's polite particle only: the other one is rewritten
 *    (see skills/crm-copilot/particles.ts).
 */
export function applyGuardrails(out: SuggestionOutput, ctx: AiContext): { output: SuggestionOutput; draftReplaced: boolean; particleNormalised: boolean } {
  let result = out;
  const terminal = ctx.lead.stage === "won" || ctx.lead.stage === "lost";
  if (terminal && !ctx.lead.newestEventIsInbound) {
    result = { ...result, draftReply: null, nextBestAction: { ...result.nextBestAction, type: "wait" } };
  }
  let draftReplaced = false;
  if (result.draftReply !== null) {
    const found = unsupportedOffer(result.draftReply, ctx);
    if (found) {
      draftReplaced = true;
      result = {
        ...result,
        draftReply: neutralReply(ctx),
        scoreReasons: withReason(
          result.scoreReasons,
          found === "a price"
            ? "แทนที่ร่างข้อความ: ระบุราคาที่ไม่ตรงกับมูลค่าลีดหรือข้อความที่เราส่งไป"
            : "แทนที่ร่างข้อความ: ห้ามกล่าวถึงส่วนลด โปรโมชัน หรือเปอร์เซ็นต์",
        ),
      };
    }
  }
  let particleNormalised = false;
  if (result.draftReply !== null) {
    const fixed = normalizeParticles(result.draftReply, ctx.politeParticle, [ctx.contact.fullName, ctx.company?.name]);
    if (fixed !== result.draftReply) {
      particleNormalised = true;
      result = { ...result, draftReply: fixed };
    }
  }
  return { output: result, draftReplaced, particleNormalised };
}

export const enforceGuardrails = (out: SuggestionOutput, ctx: AiContext): SuggestionOutput => applyGuardrails(out, ctx).output;

function classify(err: unknown, timedOut: boolean): FailureReason {
  if (timedOut) return "timeout";
  if (err instanceof AdapterError) {
    if (err.kind === "http") return err.status === 429 ? "http_429" : (err.status ?? 0) >= 500 ? "http_5xx" : "http_4xx";
    return err.kind;
  }
  return "network";
}

const add = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

export async function generateSuggestion(
  ctx: AiContext,
  deps: { adapter: LlmAdapter | null; forceFallback?: boolean; timeoutMs?: number; maxTokens?: number },
): Promise<GenerateResult> {
  const started = Date.now();
  const fallback = (failure: FailureReason, attempts: number, usage: Usage, adapter: LlmAdapter | null): GenerateResult => ({
    ...applyGuardrails(ruleBasedSuggestion(ctx), ctx),
    rawOutput: null,
    source: "fallback",
    model: null,
    promptVersion: PROMPT_VERSION,
    usage,
    estimatedCostUsd: adapter ? estimateCostUsd(adapter.name, adapter.model, usage) : 0,
    attempts,
    durationMs: Date.now() - started,
    failure,
  });

  if (deps.forceFallback) return fallback("simulated", 0, ZERO_USAGE, null);
  if (!deps.adapter) return fallback("not_configured", 0, ZERO_USAGE, null);

  const { adapter } = deps;
  const system = SYSTEM_PROMPT;
  const user = buildUserPrompt(ctx);
  let usage = ZERO_USAGE;
  let failure: FailureReason = "network";

  let attemptsMade = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? TIMEOUT_MS);
    try {
      const res = await adapter.generate({ system, user, maxTokens: deps.maxTokens ?? MAX_TOKENS, signal: ac.signal, context: ctx });
      usage = add(usage, res.usage);
      let json: unknown;
      try {
        json = JSON.parse(res.text.trim());
      } catch {
        failure = "invalid_json";
        continue;
      }
      const parsed = suggestionOutputSchema.safeParse(json);
      if (!parsed.success) {
        failure = "schema";
        continue;
      }
      // Language and gender are code-enforced: a bad answer is retried once, then the Thai rule-based fallback is used.
      if (nonThaiField(parsed.data) !== null) {
        failure = "language";
        continue;
      }
      if (genderedWording(parsed.data, [ctx.contact.fullName, ctx.company?.name]) !== null) {
        failure = "gendered";
        continue;
      }
      return {
        ...applyGuardrails(parsed.data, ctx),
        rawOutput: parsed.data,
        source: "llm",
        model: adapter.model,
        promptVersion: PROMPT_VERSION,
        usage,
        estimatedCostUsd: estimateCostUsd(adapter.name, adapter.model, usage),
        attempts: attempt,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      failure = classify(err, ac.signal.aborted);
      if (failure === "http_4xx" || failure === "refusal") break; // retrying a bad key/request or a refusal cannot help
    } finally {
      clearTimeout(timer);
    }
  }
  return fallback(failure, attemptsMade, usage, adapter);
}
