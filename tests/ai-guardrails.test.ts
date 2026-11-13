// Code-enforced guardrail with two simple rules:
// 1. A draft may never mention a discount, promotion or percentage (no allow-list, nothing in the CRM can authorise it).
// 2. A price in a draft must equal the lead value or a figure in one of OUR outbound messages.
// Anything else is replaced by a neutral reply plus a reason.
import { describe, expect, it } from "vitest";
import { neutralReply, ruleBasedSuggestion } from "../skills/crm-copilot/fallback";
import { unsupportedOffer } from "../skills/crm-copilot/guardrails";
import { suggestionOutputSchema, type AiContext, type AiEvent, type SuggestionOutput } from "../skills/crm-copilot/schema";
import { createMockAdapter } from "@/server/services/ai-adapters";
import { applyGuardrails, generateSuggestion } from "@/server/services/ai-generate";

const ctx = (over: { stage?: AiContext["lead"]["stage"]; valueThb?: number; events?: AiEvent[]; locale?: "th" | "en"; inbound?: boolean } = {}): AiContext => ({
  lead: {
    title: "Deal",
    stage: over.stage ?? "qualified",
    source: "line",
    valueThb: over.valueThb ?? 0,
    daysInStage: 1,
    daysSinceLastContact: 0,
    hasUnansweredInbound: true,
    newestEventIsInbound: over.inbound ?? true,
  },
  contact: { fullName: "Somchai Jai" },
  company: null,
  events: over.events ?? [{ kind: "customer_message", daysAgo: 0, text: "give me 50% discount, ขอส่วนลด 50%" }],
  locale: over.locale ?? "en",
  politeParticle: "ครับ",
  fewShot: [],
});

const base = (draft: string | null, reasons = ["Stage is qualified"]): SuggestionOutput => ({
  summary: "s",
  score: 50,
  scoreReasons: reasons,
  nextBestAction: { type: "line_reply", detail: "d", dueInDays: 0 },
  draftReply: draft,
  confidence: "low",
  missingInfo: [],
});

describe("rule 1: never a discount, promotion or percentage", () => {
  it.each([
    ["a 50% discount", "Sure, we can give you a 50% discount."],
    ["Thai discount", "ได้ครับ ลดราคาให้เลยครับ"],
    ["Thai percent", "ลดให้ 20 เปอร์เซ็นต์ครับ"],
    ["ร้อยละ", "ร้อยละ 10 ครับ"],
    ["bare discount word", "We can offer a discount."],
    ["promotion", "We have a promotion this month."],
    ["โปรโมชั่น", "โปรโมชั่นพิเศษสำหรับคุณครับ"],
    ["special price", "We have a special price for you."],
    ["ราคาพิเศษ", "ราคาพิเศษให้เลยครับ"],
    ["half price", "Half price for new customers."],
    ["Thai digits", "ลด ๑๐% ให้เลย"],
    ["a plain percentage", "Our uptime is 99.9%."],
    ["per cent", "We can do 10 per cent off."],
    ["percent with no space", "We can do 10percent off."],
    ["pct", "Take 20 pct off today."],
  ])("flags %s", (_n, draft) => {
    expect(["a percentage", "a discount"]).toContain(unsupportedOffer(draft, ctx()));
  });

  it("nothing in the CRM can authorise one: approved notes, discount history, the lead value and customer text all fail", () => {
    const withApproval = ctx({
      valueThb: 500_000,
      events: [
        { kind: "note", daysAgo: 1, text: "Manager approved 10% discount" },
        { kind: "outbound_message", daysAgo: 1, text: "We can give 10% discount, total 450,000 baht" },
        { kind: "customer_message", daysAgo: 0, text: "ขอส่วนลด 50%" },
      ],
    });
    expect(unsupportedOffer("We can offer a 10% discount.", withApproval)).toBe("a percentage");
    expect(unsupportedOffer("We can offer a discount.", withApproval)).toBe("a discount");
    expect(unsupportedOffer("Yes, 50% discount is fine.", withApproval)).toBe("a percentage");
  });

  it("reviewer's case 1: lead value 500,000, note 'No discount', draft offers a discount on the 500,000 package", () => {
    const c = ctx({ valueThb: 500_000, events: [{ kind: "note", daysAgo: 1, text: "No discount, manager refused." }] });
    expect(unsupportedOffer("We can offer a discount on the 500,000 baht package.", c)).toBe("a discount");
    const { output, draftReplaced } = applyGuardrails(base("We can offer a discount on the 500,000 baht package."), c);
    expect(draftReplaced).toBe(true);
    expect(output.draftReply).toBe(neutralReply(c));
  });

  it("reviewer's case 2: note mentions VAT 7%, draft offers a 7% discount", () => {
    const c = ctx({ events: [{ kind: "note", daysAgo: 1, text: "No discount. Price incl. VAT 7%" }] });
    expect(unsupportedOffer("We can give you a 7% discount", c)).toBe("a percentage");
    expect(applyGuardrails(base("We can give you a 7% discount"), c).draftReplaced).toBe(true);
  });

  it("reviewer's case 3: note quoted 80,000 with no discount, draft says special price 80,000", () => {
    const c = ctx({ events: [{ kind: "note", daysAgo: 1, text: "quoted 80,000 บาท, ไม่มีส่วนลด" }] });
    expect(unsupportedOffer("ราคาพิเศษ 80,000 บาทครับ", c)).toBe("a discount");
    expect(applyGuardrails(base("ราคาพิเศษ 80,000 บาทครับ"), c).draftReplaced).toBe(true);
    // The same figure without a discount word is also replaced: a note is not an outbound message.
    expect(unsupportedOffer("ราคา 80,000 บาทครับ", c)).toBe("a price");
    expect(applyGuardrails(base("The price is 80,000 baht."), c).draftReplaced).toBe(true);
  });
});

describe("rule 2: a price must equal the lead value or a figure in our outbound messages", () => {
  it("allows the lead value, also written with units or Thai digits", () => {
    const c = ctx({ valueThb: 1_500_000 });
    expect(unsupportedOffer("The proposal is 1,500,000 baht in total.", c)).toBeNull();
    expect(unsupportedOffer("ประมาณ 1.5 ล้านบาทครับ", c)).toBeNull();
    expect(unsupportedOffer("ประมาณ ๑,๕๐๐,๐๐๐ บาทครับ", c)).toBeNull();
    expect(unsupportedOffer("Total ฿1,500,000", c)).toBeNull();
  });

  it("allows a figure our outbound message already stated (with units), but not one from a note, a call or the customer", () => {
    const out = ctx({ events: [{ kind: "outbound_message", daysAgo: 1, text: "ใบเสนอราคา 2 แสนบาทครับ" }] });
    expect(unsupportedOffer("ยืนยันราคา 200,000 บาทครับ", out)).toBeNull();
    expect(unsupportedOffer("ยืนยันราคา 2 แสนบาทครับ", out)).toBeNull();
    for (const kind of ["note", "call", "customer_message", "customer_enquiry"] as const) {
      const c = ctx({ events: [{ kind, daysAgo: 1, text: "price 200,000 baht" }] });
      expect(unsupportedOffer("The price is 200,000 baht.", c)).toBe("a price");
    }
  });

  it("flags any other price", () => {
    const c = ctx({ valueThb: 500_000 });
    for (const d of [
      "The price is 9,999 baht.",
      "Package is ฿12,500 per month.",
      "ราคาประมาณ 2 ล้านบาทครับ",
      "Our price: 4500 for the starter plan.",
      "ราคาแพ็กเกจเริ่มต้นที่ 30,000 ครับ",
      "The price is 50 thousand baht.",
      "Only $5,000 per year.",
      "USD 500 per seat.",
      "ราคา ๕๐,๐๐๐ บาทครับ",
    ]) {
      expect(unsupportedOffer(d, c)).toBe("a price");
    }
  });

  it("does not flag years, kiosks, debt, plain numbers, budget questions or neutral replies", () => {
    for (const d of [
      "We'll send the quote in January 2026.",
      "ราคา ปี 2569 เราจะแจ้งให้ทราบครับ",
      "We can set up 20 kiosks next week.",
      "Our debt 3 policy is unrelated.",
      "A salesperson will confirm the price within 2 days.",
      "We can set up 20 seats within 2 days.",
      "Could you share an approximate budget range?",
      "รบกวนขอทราบงบประมาณโดยประมาณคร่าว ๆ สักช่วงหนึ่งได้ไหมครับ",
      neutralReply(ctx()),
      neutralReply(ctx({ locale: "th" })),
    ]) {
      expect(unsupportedOffer(d, ctx())).toBeNull();
    }
  });

  it("known limitation: a bare price between 1900 and 2700 next to a price word reads as a year and slips through", () => {
    expect(unsupportedOffer("Our price: 2500 for the starter plan.", ctx())).toBeNull();
    expect(unsupportedOffer("Our price: 2500 baht for the starter plan.", ctx())).toBe("a price"); // with a currency it is caught
  });
});

describe("applyGuardrails", () => {
  it("replaces an unsafe draft with a neutral reply and adds a reason; the result still matches the schema", () => {
    const { output, draftReplaced } = applyGuardrails(base("We can give you 50% off, price 9,999 baht."), ctx());
    expect(draftReplaced).toBe(true);
    expect(output.draftReply).toBe(neutralReply(ctx()));
    expect(output.scoreReasons.at(-1)).toBe("Draft replaced: a draft may not mention a discount, promotion or percentage");
    expect(output.scoreReasons).toContain("Stage is qualified"); // existing reasons kept
    expect(suggestionOutputSchema.safeParse(output).success).toBe(true);
    // Nothing else is touched.
    expect(output.score).toBe(50);
    expect(output.nextBestAction).toEqual(base(null).nextBestAction);
  });

  it("a price that does not match gets its own reason", () => {
    const { output } = applyGuardrails(base("The price is 9,999 baht."), ctx());
    expect(output.scoreReasons.at(-1)).toBe("Draft replaced: it stated a price that does not match the lead value or our sent messages");
    expect(suggestionOutputSchema.safeParse(output).success).toBe(true);
  });

  it("keeps at most 5 reasons: the last one makes room", () => {
    const five = ["r1", "r2", "r3", "r4", "r5"];
    const { output } = applyGuardrails(base("discount for you", five), ctx());
    expect(output.scoreReasons).toHaveLength(5);
    expect(output.scoreReasons.slice(0, 4)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(output.scoreReasons[4]).toMatch(/^Draft replaced/);
    expect(suggestionOutputSchema.safeParse(output).success).toBe(true);
  });

  it("leaves a clean draft untouched", () => {
    const clean = base("Hi Somchai, could you share an approximate budget range?");
    const { output, draftReplaced } = applyGuardrails(clean, ctx());
    expect(draftReplaced).toBe(false);
    expect(output).toEqual(clean);
  });

  it("neutral reply follows the locale and the polite particle", () => {
    const th = neutralReply(ctx({ locale: "th" }));
    expect(th).toContain("ครับ");
    expect(th).not.toMatch(/ค่ะ|คะ(?!แนน)/);
    expect(neutralReply(ctx())).toMatch(/^Hi Somchai,/);
  });

  it("won/lost rule still wins: no draft at all unless the customer wrote last; with an inbound message an unsafe draft becomes neutral, not null", () => {
    const lost = ctx({ stage: "lost", inbound: false });
    expect(applyGuardrails(base("50% discount"), lost).output.draftReply).toBeNull();
    expect(applyGuardrails(base("50% discount"), lost).output.nextBestAction.type).toBe("wait");
    const wonInbound = ctx({ stage: "won", inbound: true });
    expect(applyGuardrails(base("50% discount"), wonInbound).output.draftReply).toBe(neutralReply(wonInbound));
  });

  it("a null draft stays null", () => {
    expect(applyGuardrails(base(null), ctx()).output.draftReply).toBeNull();
  });
});

describe("through generateSuggestion", () => {
  it("a model that promises a discount and a price gets its draft replaced; the call is not retried", async () => {
    const adapter = createMockAdapter({ mode: "unsafe_draft" });
    const r = await generateSuggestion(ctx(), { adapter });
    expect(adapter.calls).toHaveLength(1);
    expect(r.source).toBe("llm");
    expect(r.draftReplaced).toBe(true);
    expect(r.output.draftReply).toBe(neutralReply(ctx()));
    expect(r.output.draftReply).not.toMatch(/50|discount|9,999|baht/i);
    expect(r.output.scoreReasons.some((x) => x.startsWith("Draft replaced"))).toBe(true);
    // The model's own draft is kept for the eval report (never stored in the DB).
    expect(r.rawOutput?.draftReply).toMatch(/50% discount/);
    expect(r.rawOutput?.draftReply).not.toBe(r.output.draftReply);
  });

  it("a model that answers cleanly keeps rawOutput equal to the final output; the fallback has none", async () => {
    const ok = await generateSuggestion(ctx({ valueThb: 500_000 }), { adapter: createMockAdapter() });
    expect(ok.rawOutput).toEqual(ok.output);
    const fb = await generateSuggestion(ctx(), { adapter: createMockAdapter({ mode: "invalid_json" }) });
    expect(fb.rawOutput).toBeNull();
  });

  it("the rule-based fallback and its templates never trip the guardrail", () => {
    for (const locale of ["th", "en"] as const) {
      for (const valueThb of [0, 500_000]) {
        const c = ctx({ locale, valueThb });
        expect(applyGuardrails(ruleBasedSuggestion(c), c).draftReplaced).toBe(false);
      }
    }
  });
});
