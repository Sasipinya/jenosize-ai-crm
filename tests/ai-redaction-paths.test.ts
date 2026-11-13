// Proves no phone/email can reach the LLM: (1) the prompt renderer redacts even a hand-built context,
// (2) the real call path does too, (3) a source scan fails if a new path to the model appears.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_FIELD_CHARS, redactPii } from "../skills/crm-copilot/redact";
import { buildUserPrompt, SYSTEM_PROMPT } from "../skills/crm-copilot/prompt";
import type { AiContext } from "../skills/crm-copilot/schema";
import { createMockAdapter } from "@/server/services/ai-adapters";
import { generateSuggestion } from "@/server/services/ai-generate";

const PHONES = ["081-234-5678", "0812345678", "+66 81 234 5678", "6681-2345678", "๐๘๑-๒๓๔-๕๖๗๘", "081–234–5678"];
const EMAIL = "somchai.secret@example.com";
const LEAKS = /@|081-234-5678|0812345678|81 234 5678|6681-2345678|๐๘๑|081–234–5678/;

// Built by hand on purpose: it never went through buildContext, so nothing was redacted yet.
const rawCtx: AiContext = {
  lead: {
    title: `Enquiry from ${EMAIL}`,
    stage: "new",
    source: "line",
    valueThb: 1_500_000,
    daysInStage: 1,
    daysSinceLastContact: 1,
    hasUnansweredInbound: true,
    newestEventIsInbound: true,
  },
  contact: { fullName: `Somchai ${PHONES[0]}` },
  company: { name: `Acme ${PHONES[1]}`, industry: `Retail ${EMAIL}` },
  events: [
    { kind: "customer_message", daysAgo: 1, text: `call me ${PHONES[2]} or ${EMAIL}` },
    { kind: "customer_enquiry", daysAgo: 2, text: `thai digits ${PHONES[4]}` },
    { kind: "note", daysAgo: 1, text: `dash number ${PHONES[5]}` },
    { kind: "call", daysAgo: 1, text: `cc ${PHONES[3]}` },
    { kind: "stage_change", daysAgo: 1, text: `new → qualified ${EMAIL}` },
    { kind: "outbound_message", daysAgo: 1, text: `we will call ${PHONES[1]}` },
  ],
  locale: "en",
  politeParticle: "ครับ",
  fewShot: [`Send it to ${EMAIL} or call ${PHONES[0]}`],
};

describe("prompt renderer redacts on its own", () => {
  it("buildUserPrompt on a never-redacted context contains no phone or email", () => {
    const prompt = buildUserPrompt(rawCtx);
    expect(prompt).not.toMatch(LEAKS);
    expect(prompt).toContain("[email]");
    expect(prompt).toContain("[phone]");
    expect(prompt).toContain("1500000"); // budgets survive
  });

  it("the full generateSuggestion path sends only redacted text to the adapter", async () => {
    const adapter = createMockAdapter();
    await generateSuggestion(rawCtx, { adapter });
    const sent = adapter.calls[0]!;
    expect(sent.user).not.toMatch(LEAKS);
    expect(sent.system).not.toMatch(LEAKS);
    expect(SYSTEM_PROMPT).not.toMatch(/@/);
  });
});

describe("redaction input cap and dashes", () => {
  it("redacts numbers written with en/em dashes", () => {
    expect(redactPii("call 081–234–5678 or 081—234—5678")).toBe("call [phone] or [phone]");
    expect(redactPii("budget 100000–200000 baht")).toBe("budget 100000–200000 baht");
  });

  it("cuts each field to 5,000 characters before redacting, and stays fast on hostile input", () => {
    expect(redactPii("x".repeat(MAX_FIELD_CHARS + 1000)).length).toBe(MAX_FIELD_CHARS);
    expect(redactPii(`${"x".repeat(MAX_FIELD_CHARS)} 0812345678`)).not.toMatch(/\d/); // past the cap: never sent
    const started = Date.now();
    redactPii("a".repeat(1_000_000));
    redactPii("1".repeat(1_000_000));
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

// ---- Source scan: every path that can put text in front of the model ----
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p.replaceAll("\\", "/"));
  }
  return out;
}
const files = ["src", "skills", "scripts"].flatMap((d) => walk(d));
const read = (f: string) => readFileSync(f, "utf8");
const filesMatching = (re: RegExp) => files.filter((f) => re.test(read(f))).sort();

describe("call-site audit (fails if a new path to the model appears)", () => {
  it("only ai-generate.ts calls adapter.generate()", () => {
    expect(filesMatching(/\.generate\(/)).toEqual(["src/server/services/ai-generate.ts"]);
  });

  it("buildUserPrompt is called only by ai-generate.ts and the eval runner", () => {
    const callers = filesMatching(/buildUserPrompt\(/).filter((f) => f !== "skills/crm-copilot/prompt.ts");
    expect(callers).toEqual(["skills/crm-copilot/evals/run.ts", "src/server/services/ai-generate.ts"]);
  });

  it("only the adapters file talks to the Anthropic API", () => {
    expect(filesMatching(/api\.anthropic\.com|\/v1\/messages/)).toEqual(["src/server/services/ai-adapters.ts"]);
  });

  it("generateSuggestion has exactly two callers and both build the context with buildContext", () => {
    const callers = filesMatching(/\bgenerateSuggestion\(/).filter((f) => f !== "src/server/services/ai-generate.ts");
    expect(callers).toEqual(["skills/crm-copilot/evals/run.ts", "src/server/services/ai-suggestions.ts"]);
    for (const f of callers) expect(read(f)).toContain("buildContext(");
  });

  it("the prompt renderer applies redactPii to its text", () => {
    expect(read("skills/crm-copilot/prompt.ts")).toMatch(/redactPii\(s\)/);
  });
});
