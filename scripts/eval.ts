// pnpm eval                  → runs the eval cases on the mock adapter (free, no key). Prints a table.
// pnpm eval --adapter claude → runs them on the real model (costs tokens; needs ANTHROPIC_API_KEY in
//                              .env.local) and appends a run section to docs/eval-report.md.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { PROMPT_VERSION } from "../skills/crm-copilot/prompt";
import { runEvalCases, type CaseResult } from "../skills/crm-copilot/evals/run";
import { adapterFromEnv, DEFAULT_MODEL } from "../src/server/services/ai-adapters";
import { fenced } from "./lib/md-fence";

const REPORT = "docs/eval-report.md";
const useClaude = process.argv.includes("--adapter") && process.argv[process.argv.indexOf("--adapter") + 1] === "claude";

if (useClaude) {
  try {
    process.loadEnvFile(".env.local"); // read by you, on your machine; never printed
  } catch {
    /* env may already be exported */
  }
  process.env.AI_ADAPTER = "claude";
} else {
  process.env.AI_ADAPTER = "mock";
}

const adapter = adapterFromEnv();
if (!adapter) {
  console.error("AI_ADAPTER=claude needs ANTHROPIC_API_KEY (set it in .env.local). Nothing was run.");
  process.exit(2);
}

const results = await runEvalCases(adapter);
const fmtCost = (c: number | null) => (c === null ? "n/a" : `$${c.toFixed(6)}`);

for (const r of results) {
  const tag = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "SKIP";
  console.log(`${tag}  #${r.id} ${r.title}${r.failures.length ? `\n      ${r.failures.join("\n      ")}` : ""}${r.note ? ` (${r.note})` : ""}`);
  if (r.draftReplaced) console.log("      guardrail replaced the model's draft (see the report for the original)");
  else if (r.particleNormalised) console.log("      guardrail rewrote the polite particle (see the report for the original)");
  if (r.status === "fail" && r.output) console.log(`      output: ${JSON.stringify(r.output)}`); // synthetic eval data, safe to print
}
const failed = results.filter((r) => r.status === "fail").length;
console.log(`\n${results.length - failed} ok, ${failed} failed · adapter=${adapter.name} model=${adapter.model} prompt=${PROMPT_VERSION}`);

if (useClaude) writeReport(results);
process.exit(failed ? 1 : 0);

function writeReport(rows: CaseResult[]) {
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const header = "# crm-copilot eval report\n\nAuto-written by `pnpm eval --adapter claude`. One section per run. Fill in the manual score column by hand (1-5, or pass/fail).\n";
  if (!existsSync(REPORT)) writeFileSync(REPORT, header);
  const total = rows.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0);
  const inTok = rows.reduce((s, r) => s + r.usage.inputTokens, 0);
  const outTok = rows.reduce((s, r) => s + r.usage.outputTokens, 0);
  const lines = [
    "",
    `## Run ${new Date().toISOString()}`,
    "",
    `- Date: ${new Date().toISOString().slice(0, 10)}`,
    `- Model: ${model}`,
    `- prompt_version: ${PROMPT_VERSION}`,
    `- Totals: ${inTok} input tokens, ${outTok} output tokens, est. ${fmtCost(total)}`,
    "",
    "LLM output is non-deterministic: one run is a sample, not proof. A case that fails here may pass on the next run and the other way round.",
    "",
    "| # | Case | Auto result | Source | Input tok | Output tok | Cache read tok | Cache write tok | Est. cost | Manual score |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => {
      const replaced = r.draftReplaced ? " (guardrail replaced the model's draft)" : r.particleNormalised ? " (guardrail rewrote the polite particle)" : "";
      const auto = r.status === "pass" ? `PASS${replaced}` : r.status === "fail" ? `FAIL${replaced}: ${r.failures.join("; ").replaceAll("|", "/")}` : `SKIP (${r.note})`;
      return `| ${r.id} | ${r.title} | ${auto} | ${r.source ?? "-"} | ${r.usage.inputTokens} | ${r.usage.outputTokens} | ${r.usage.cacheReadTokens} | ${r.usage.cacheWriteTokens} | ${fmtCost(r.estimatedCostUsd)} | ${r.manual ? "" : "n/a"} |`;
    }),
    "",
    "<details><summary>Model outputs of this run (before and after the guardrails)</summary>",
    "",
    ...rows
      .filter((r) => r.output)
      .flatMap((r) => [
        `**#${r.id} ${r.title}** — ${r.status.toUpperCase()}${r.failures.length ? `: ${r.failures.join("; ").replaceAll("`", "'")}` : ""}`,
        "",
        ...((r.draftReplaced || r.particleNormalised) && r.rawOutput
          ? [`Model output BEFORE the guardrail (its draft was ${r.draftReplaced ? "replaced" : "rewritten"}):`, "", ...fenced(r.rawOutput), "Final output (after guardrails):", ""]
          : ["Final output (the guardrails changed nothing):", ""]),
        ...fenced(r.output),
      ]),
    "</details>",
    "",
  ];
  appendFileSync(REPORT, lines.join("\n"));
  console.log(`Report appended to ${REPORT}`);
}
