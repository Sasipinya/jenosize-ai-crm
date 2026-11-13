// Eval runner for crm-copilot. Builds the context from each case, runs the real orchestrator
// (prompt → adapter → Zod → guardrails) and checks the output. No DB, no network with the mock.
import { createMockAdapter, type LlmAdapter, type MockMode, type Usage, ZERO_USAGE } from "../../../src/server/services/ai-adapters";
import { buildContext } from "../../../src/server/services/ai-context";
import { generateSuggestion } from "../../../src/server/services/ai-generate";
import type { TimelineItem } from "../../../src/server/services/leads";
import { buildUserPrompt } from "../prompt";
import { suggestionOutputSchema, type SuggestionOutput } from "../schema";
import cases from "./cases.json";

type Check =
  | { type: "scoreBetween"; min: number; max: number }
  | { type: "scoreAtMost"; max: number }
  | { type: "actionIn"; values: string[] }
  | { type: "dueInDaysAtMost"; max: number }
  | { type: "draftNull" }
  | { type: "draftNotNull" }
  | { type: "draftMatch" | "draftNotMatch" | "summaryMatch" | "reasonMatch" | "promptMatch" | "promptNotMatch" | "outputNotMatch"; pattern: string }
  | { type: "confidence"; value: string }
  | { type: "source"; value: "llm" | "fallback" }
  | { type: "missingInfoNonEmpty" };

type EvalEvent = { daysAgo: number; kind: "in" | "out" | "note" | "call" | "website" | "stage"; text: string };
export type EvalCase = {
  id: number;
  title: string;
  manual: boolean;
  kind?: "service";
  coveredBy?: string;
  forceMode?: MockMode;
  input: null | {
    lead: { title: string; stage: "new" | "qualified" | "proposal" | "won" | "lost"; source: "website" | "manual" | "line"; valueThb: number; daysInStage: number };
    contact: { fullName: string };
    company: { name: string; industry: string | null } | null;
    politeParticle: "ครับ" | "ค่ะ";
    fewShot?: string[];
    events: EvalEvent[];
  };
  checks: Check[];
};

export type CaseResult = {
  id: number;
  title: string;
  manual: boolean;
  status: "pass" | "fail" | "skipped";
  failures: string[];
  source: "llm" | "fallback" | null;
  /** What the pipeline returned (after Zod and guardrails). Saved in the eval report so failures can be inspected. */
  output: SuggestionOutput | null;
  /** What the model answered before the code guardrails. Differs from `output` when the guardrail replaced the draft. */
  rawOutput: SuggestionOutput | null;
  draftReplaced: boolean;
  usage: Usage;
  estimatedCostUsd: number | null;
  note?: string;
};

const NOW = new Date("2026-11-13T09:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function toTimeline(events: EvalEvent[]): TimelineItem[] {
  return events.map((e, i): TimelineItem => {
    const id = `e${i}`;
    const at = ago(e.daysAgo);
    switch (e.kind) {
      case "in":
        return { kind: "message", id, at, direction: "in", status: "sent", body: e.text };
      case "out":
        return { kind: "message", id, at, direction: "out", status: "sent", body: e.text };
      case "website":
        return { kind: "activity", id, at, type: "note", actorName: null, payload: { text: e.text, source: "website", system: true } };
      case "stage": {
        const [from, rest] = e.text.split(" → ");
        const [to, reason] = (rest ?? "").split(" (reason: ");
        return { kind: "activity", id, at, type: "stage_change", actorName: null, payload: { from, to, ...(reason ? { lostReason: reason.replace(")", "") } : {}) } };
      }
      default:
        return { kind: "activity", id, at, type: e.kind, actorName: "Sales", payload: { text: e.text } };
    }
  });
}

function evaluate(check: Check, out: SuggestionOutput, source: "llm" | "fallback", prompt: string): string | null {
  const re = (p: string) => new RegExp(p, "i");
  switch (check.type) {
    case "scoreBetween":
      return out.score >= check.min && out.score <= check.max ? null : `score ${out.score} not in ${check.min}-${check.max}`;
    case "scoreAtMost":
      return out.score <= check.max ? null : `score ${out.score} above ${check.max}`;
    case "actionIn":
      return check.values.includes(out.nextBestAction.type) ? null : `action ${out.nextBestAction.type} not in ${check.values.join("|")}`;
    case "dueInDaysAtMost":
      return out.nextBestAction.dueInDays <= check.max ? null : `dueInDays ${out.nextBestAction.dueInDays} above ${check.max}`;
    case "draftNull":
      return out.draftReply === null ? null : "draftReply should be null";
    case "draftNotNull":
      return out.draftReply !== null ? null : "draftReply should not be null";
    case "draftMatch":
      return out.draftReply !== null && re(check.pattern).test(out.draftReply) ? null : `draft does not match /${check.pattern}/`;
    case "draftNotMatch":
      return out.draftReply !== null && re(check.pattern).test(out.draftReply) ? `draft matches forbidden /${check.pattern}/` : null;
    case "summaryMatch":
      return re(check.pattern).test(out.summary) ? null : `summary does not match /${check.pattern}/`;
    case "reasonMatch":
      return re(check.pattern).test(out.scoreReasons.join(" | ")) ? null : `scoreReasons do not match /${check.pattern}/`;
    case "promptMatch":
      return re(check.pattern).test(prompt) ? null : `prompt does not match /${check.pattern}/`;
    case "promptNotMatch":
      return re(check.pattern).test(prompt) ? `prompt matches forbidden /${check.pattern}/` : null;
    case "outputNotMatch":
      return re(check.pattern).test(JSON.stringify(out)) ? `output matches forbidden /${check.pattern}/` : null;
    case "confidence":
      return out.confidence === check.value ? null : `confidence ${out.confidence}, expected ${check.value}`;
    case "source":
      return source === check.value ? null : `source ${source}, expected ${check.value}`;
    case "missingInfoNonEmpty":
      return out.missingInfo.length > 0 ? null : "missingInfo is empty";
  }
}

export async function runEvalCases(adapter: LlmAdapter | null, opts: { timeoutMs?: number; only?: number[] } = {}): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const c of [...(cases as EvalCase[])].sort((a, b) => a.id - b.id)) {
    if (opts.only && !opts.only.includes(c.id)) continue;
    const base = { id: c.id, title: c.title, manual: c.manual, usage: ZERO_USAGE, estimatedCostUsd: 0 as number | null, source: null, output: null as SuggestionOutput | null, rawOutput: null as SuggestionOutput | null, draftReplaced: false };
    if (c.kind === "service" || !c.input) {
      results.push({ ...base, status: "skipped", failures: [], note: `covered by ${c.coveredBy}` });
      continue;
    }
    const ctx = buildContext({
      lead: { ...c.input.lead, stageChangedAt: ago(c.input.lead.daysInStage) },
      contact: c.input.contact,
      company: c.input.company,
      timeline: toTimeline(c.input.events),
      politeParticle: c.input.politeParticle,
      fewShot: c.input.fewShot,
      now: NOW,
    });
    const prompt = buildUserPrompt(ctx);
    const used = c.forceMode ? createMockAdapter({ mode: c.forceMode }) : adapter;
    const res = await generateSuggestion(ctx, { adapter: used, timeoutMs: opts.timeoutMs });

    const failures: string[] = [];
    const schema = suggestionOutputSchema.safeParse(res.output);
    if (!schema.success) failures.push("output does not match the Zod schema");
    if (!c.forceMode && res.source === "fallback") failures.push(`fell back unexpectedly (${res.failure})`);
    for (const check of c.checks) {
      const f = evaluate(check, res.output, res.source, prompt);
      if (f) failures.push(f);
    }
    results.push({ ...base, status: failures.length ? "fail" : "pass", failures, source: res.source, output: res.output, rawOutput: res.rawOutput, draftReplaced: res.draftReplaced, usage: res.usage, estimatedCostUsd: res.estimatedCostUsd });
  }
  return results;
}
