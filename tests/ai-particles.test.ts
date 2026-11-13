// Polite particle: the reply uses the lead owner's particle only. The guardrail rewrites the other one in code.
import { describe, expect, it } from "vitest";
import { normalizeParticles } from "../skills/crm-copilot/particles";
import type { AiContext, SuggestionOutput } from "../skills/crm-copilot/schema";
import { createMockAdapter } from "@/server/services/ai-adapters";
import { applyGuardrails, generateSuggestion } from "@/server/services/ai-generate";

// The draft the real model produced in production: the customer wrote ครับ, the model copied it.
const MIXED = "สวัสดีครับ คุณสมชาย ขอบคุณที่ติดต่อมาค่ะ รบกวนขอทราบรายละเอียดเพิ่มเติมได้ไหมคะ ขอบคุณครับ";

describe("normalizeParticles: owner says ค่ะ", () => {
  it.each([
    ["the production draft", MIXED, "สวัสดีค่ะ คุณสมชาย ขอบคุณที่ติดต่อมาค่ะ รบกวนขอทราบรายละเอียดเพิ่มเติมได้ไหมคะ ขอบคุณค่ะ"],
    ["statements", "สวัสดีครับ ขอบคุณครับ ได้ครับ", "สวัสดีค่ะ ขอบคุณค่ะ ได้ค่ะ"],
    ["ไหมครับ", "ได้ไหมครับ", "ได้ไหมคะ"],
    ["มั้ยครับ", "สะดวกมั้ยครับ", "สะดวกมั้ยคะ"],
    ["หรือเปล่าครับ", "ใช่หรือเปล่าครับ", "ใช่หรือเปล่าคะ"],
    ["หรือไม่ครับ", "สนใจหรือไม่ครับ", "สนใจหรือไม่คะ"],
    ["เท่าไหร่ครับ", "งบประมาณเท่าไหร่ครับ", "งบประมาณเท่าไหร่คะ"],
    ["วันไหนครับ", "สะดวกวันไหนครับ", "สะดวกวันไหนคะ"],
    ["อะไรครับ", "ต้องการอะไรครับ", "ต้องการอะไรคะ"],
    ["นะครับ", "ช่วยแจ้งกลับด้วยนะครับ", "ช่วยแจ้งกลับด้วยนะคะ"],
    ["before a question mark", "ว่างวันนี้ครับ?", "ว่างวันนี้คะ?"],
    ["ครับผม", "รับทราบครับผม", "รับทราบค่ะ"],
  ])("%s", (_n, input, expected) => {
    expect(normalizeParticles(input, "ค่ะ")).toBe(expected);
  });

  it("leaves ค่ะ, คะ and text without a particle alone", () => {
    for (const s of ["สวัสดีค่ะ ได้ไหมคะ", "Hi Somchai, thank you for reaching out.", "คะแนนของคุณคือ 70", ""]) {
      expect(normalizeParticles(s, "ค่ะ")).toBe(s);
    }
  });
});

describe("normalizeParticles: owner says ครับ", () => {
  it.each([
    ["the production draft", MIXED, "สวัสดีครับ คุณสมชาย ขอบคุณที่ติดต่อมาครับ รบกวนขอทราบรายละเอียดเพิ่มเติมได้ไหมครับ ขอบคุณครับ"],
    ["ค่ะ", "สวัสดีค่ะ ขอบคุณค่ะ", "สวัสดีครับ ขอบคุณครับ"],
    ["คะ in questions", "ได้ไหมคะ ใช่หรือเปล่าคะ", "ได้ไหมครับ ใช่หรือเปล่าครับ"],
    ["ค๊ะ", "ขอบคุณค๊ะ", "ขอบคุณครับ"],
  ])("%s", (_n, input, expected) => {
    expect(normalizeParticles(input, "ครับ")).toBe(expected);
  });

  it("never touches words that merely contain คะ (คะแนน, คะเน, คะยั้นคะยอ, คะนอง)", () => {
    expect(normalizeParticles("คะแนนของคุณคะ", "ครับ")).toBe("คะแนนของคุณครับ"); // only the final particle changes
    for (const s of ["คะแนนรวม 70 คะแนน", "คาดคะเนได้ว่า", "อย่าคะยั้นคะยอ", "คึกคะนอง"]) {
      expect(normalizeParticles(s, "ครับ")).toBe(s);
    }
  });

  it("leaves ครับ and plain text alone", () => {
    for (const s of ["สวัสดีครับ ได้ไหมครับ", "Hi Somchai, thanks.", ""]) expect(normalizeParticles(s, "ครับ")).toBe(s);
  });
});

describe("names that contain คะ are never damaged (reviewer's blocking case)", () => {
  it("lookahead also keeps คะน้า, คะนึง and คะมำ", () => {
    for (const s of ["ผักคะน้า", "คะนึงนิจ", "คะมำ"]) expect(normalizeParticles(s, "ครับ")).toBe(s);
  });

  it("masks the contact and company names while rewriting, for both owners", () => {
    const draft = "สวัสดีค่ะ คุณคะนึงนิจ ใจดี จากบริษัท คะน้าฟาร์ม จำกัด ขอบคุณที่ติดต่อมาค่ะ ได้ไหมคะ";
    const protect = ["คะนึงนิจ ใจดี", "บริษัท คะน้าฟาร์ม จำกัด"];
    expect(normalizeParticles(draft, "ครับ", protect)).toBe("สวัสดีครับ คุณคะนึงนิจ ใจดี จากบริษัท คะน้าฟาร์ม จำกัด ขอบคุณที่ติดต่อมาครับ ได้ไหมครับ");
    // A name that would be rewritten without masking (no lookahead match), e.g. คะนิดา:
    expect(normalizeParticles("สวัสดีค่ะ คุณคะนิดา", "ครับ")).toBe("สวัสดีครับ คุณครับนิดา"); // unmasked: the bug
    expect(normalizeParticles("สวัสดีค่ะ คุณคะนิดา", "ครับ", ["คะนิดา"])).toBe("สวัสดีครับ คุณคะนิดา");
    // A name containing ครับ for a ค่ะ owner is also kept.
    expect(normalizeParticles("สวัสดีครับ คุณครับสมร", "ค่ะ", ["ครับสมร"])).toBe("สวัสดีค่ะ คุณครับสมร");
  });

  it("masking is lossless with 11+ protected names plus a protected '10' that is also in the draft (fails on the old digit-based masks)", () => {
    // 12 distinct names of 3+ characters, then the shortest protected text "10" (masked last). With the old
    // masks "<index>", the mask of the 11th name (index 10) contained "10", so masking "10" corrupted it.
    const names = ["สมชายกร", "สมหญิงดี", "วิชัยกรณ์", "นภาพรรณ", "ธนากรณ์", "พิมพ์ใจดี", "ศิริพรรณ", "อรุณีรัตน์", "มานะดีงาม", "สุดาวดีศรี", "ปรีชากุล", "กมลวรรณา"];
    const protect = [...names, "10"];
    const draft = `สวัสดีค่ะ ${names.join(" ")} ขอ 10 ชิ้น ขอบคุณค่ะ`;
    const out = normalizeParticles(draft, "ครับ", protect);
    expect(out).toBe(`สวัสดีครับ ${names.join(" ")} ขอ 10 ชิ้น ขอบคุณครับ`);
    expect(out).not.toMatch(/[-]/); // no placeholder character ever reaches the draft
  });

  it("a full name and its parts in different places, and one name inside another, survive", () => {
    expect(normalizeParticles("คุณคะนึง และ คะนึงนิจ ใจดี ค่ะ", "ครับ", ["คะนึงนิจ ใจดี", "คะนึง"])).toBe("คุณคะนึง และ คะนึงนิจ ใจดี ครับ");
    const company = "บริษัท 1 2 3 คะน้าฟาร์ม จำกัด";
    expect(normalizeParticles(`สวัสดีค่ะ จาก ${company} ค่ะ`, "ครับ", [company])).toBe(`สวัสดีครับ จาก ${company} ครับ`);
  });

  it("private-use characters: dropped from the draft, never restored into a name; a protected text containing one is ignored", () => {
    // A stray private-use character from the model (U+E100 is the first mask) must not turn into the name.
    const out = normalizeParticles("สวัสดีค่ะ  คุณสมชาย ค่ะ", "ครับ", ["สมชาย"]);
    expect(out).toBe("สวัสดีครับ  คุณสมชาย ครับ");
    expect(out).not.toMatch(/[-]/);
    // A protected text that contains a private-use character cannot collide with a mask: it is not protected.
    expect(normalizeParticles("ab ค่ะ cd", "ครับ", ["ab", "cd"])).toBe("ab ครับ cd");
    // Restore order: with several masks the result is identical to the plain draft apart from the particles.
    expect(normalizeParticles("สมชาย สมหญิง ค่ะ", "ครับ", ["สมชาย", "สมหญิง"])).toBe("สมชาย สมหญิง ครับ");
  });

  it("ignores empty, null and one-letter protected parts", () => {
    expect(normalizeParticles("ขอบคุณค่ะ", "ครับ", [null, undefined, "", "  ", "ค"])).toBe("ขอบคุณครับ");
  });
});

describe("normalizeParticles is idempotent and never mixes", () => {
  it("running it twice changes nothing more; the result has only one particle family", () => {
    for (const p of ["ค่ะ", "ครับ"] as const) {
      const once = normalizeParticles(MIXED, p);
      expect(normalizeParticles(once, p)).toBe(once);
    }
    expect(normalizeParticles(MIXED, "ค่ะ")).not.toMatch(/ครับ/);
    expect(normalizeParticles(MIXED, "ครับ")).not.toMatch(/ค่ะ|คะ(?!แนน)/);
  });
});

const ctx = (particle: "ครับ" | "ค่ะ"): AiContext => ({
  lead: { title: "Deal", stage: "qualified", source: "line", valueThb: 0, daysInStage: 1, daysSinceLastContact: 0, hasUnansweredInbound: true, newestEventIsInbound: true },
  contact: { fullName: "คุณสมชาย" },
  company: null,
  events: [{ kind: "customer_message", daysAgo: 0, text: "สวัสดีครับ ขอรายละเอียดหน่อยครับ" }],
  locale: "th",
  politeParticle: particle,
  fewShot: [],
});

const out = (draft: string | null): SuggestionOutput => ({
  summary: "s",
  score: 50,
  scoreReasons: ["r"],
  nextBestAction: { type: "line_reply", detail: "d", dueInDays: 0 },
  draftReply: draft,
  confidence: "low",
  missingInfo: [],
});

describe("guardrail: the draft speaks with the owner's particle", () => {
  it("rewrites the other particle, flags it, and touches nothing else", () => {
    const r = applyGuardrails(out(MIXED), ctx("ค่ะ"));
    expect(r.particleNormalised).toBe(true);
    expect(r.draftReplaced).toBe(false);
    expect(r.output.draftReply).toBe("สวัสดีค่ะ คุณสมชาย ขอบคุณที่ติดต่อมาค่ะ รบกวนขอทราบรายละเอียดเพิ่มเติมได้ไหมคะ ขอบคุณค่ะ");
    expect(r.output.scoreReasons).toEqual(["r"]);
    expect(r.output.score).toBe(50);
  });

  it("does nothing to a clean draft, an English draft or a null draft", () => {
    for (const d of ["สวัสดีค่ะ ได้ไหมคะ", "Hi, thanks for reaching out.", null]) {
      const r = applyGuardrails(out(d), ctx("ค่ะ"));
      expect(r.particleNormalised).toBe(false);
      expect(r.output.draftReply).toBe(d);
    }
  });

  it("a replaced (neutral) draft already uses the right particle and is not flagged as rewritten", () => {
    const r = applyGuardrails(out("ลดให้ 50% ครับ"), ctx("ค่ะ"));
    expect(r.draftReplaced).toBe(true);
    expect(r.particleNormalised).toBe(false);
    expect(r.output.draftReply).not.toMatch(/ครับ/);
  });

  it("through generateSuggestion: a model that mixes particles is fixed for both salespeople; the raw answer is kept for the report", async () => {
    for (const p of ["ค่ะ", "ครับ"] as const) {
      const r = await generateSuggestion(ctx(p), { adapter: createMockAdapter({ mode: "mixed_particles" }) });
      expect(r.source).toBe("llm");
      expect(r.particleNormalised).toBe(true);
      expect(r.rawOutput?.draftReply).toContain("สวัสดีครับ"); // what the model wrote
      expect(r.output.draftReply).toBe(normalizeParticles(r.rawOutput!.draftReply!, p));
      if (p === "ค่ะ") expect(r.output.draftReply).not.toMatch(/ครับ/);
      else expect(r.output.draftReply).not.toMatch(/ค่ะ|คะ(?!แนน)/);
    }
  });

  it("the rule-based fallback never needs a rewrite, also for a contact called คะนึงนิจ and a company called คะน้าฟาร์ม", async () => {
    const names = [
      { fullName: "คุณสมชาย", company: null },
      { fullName: "คะนึงนิจ ใจดี", company: { name: "บริษัท คะน้าฟาร์ม จำกัด", industry: null } },
      { fullName: "คะนิดา", company: null },
    ];
    for (const p of ["ค่ะ", "ครับ"] as const) {
      for (const n of names) {
        const c: AiContext = { ...ctx(p), contact: { fullName: n.fullName }, company: n.company };
        const r = await generateSuggestion(c, { adapter: createMockAdapter({ mode: "invalid_json" }) });
        expect(r.source).toBe("fallback");
        expect(r.particleNormalised).toBe(false);
        expect(r.output.draftReply).toContain(n.fullName.split(" ")[0]!); // the name survived intact
      }
    }
  });

  it("a model draft greeting a customer called คะนึงนิจ keeps the name when the particle is rewritten", () => {
    const c: AiContext = { ...ctx("ครับ"), contact: { fullName: "คะนึงนิจ ใจดี" } };
    const r = applyGuardrails(out("สวัสดีค่ะ คุณคะนึงนิจ ขอบคุณที่ติดต่อมาค่ะ"), c);
    expect(r.particleNormalised).toBe(true);
    expect(r.output.draftReply).toBe("สวัสดีครับ คุณคะนึงนิจ ขอบคุณที่ติดต่อมาครับ");
    const en = applyGuardrails(out("Hi คะนึงนิจ, thanks ค่ะ"), c);
    expect(en.output.draftReply).toBe("Hi คะนึงนิจ, thanks ครับ");
  });
});
