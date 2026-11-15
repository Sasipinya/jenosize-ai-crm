// Rule-based fallback: deterministic, no network, always schema-valid. Used when the LLM fails,
// times out, is not configured, or the admin toggle simulate_ai_down is on.
import type { AiContext, SuggestionOutput } from "./schema";

const STALE_DAYS = 14;
const VERY_STALE_DAYS = 30;
const GIVE_UP_DAYS = 45;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

// The rule-based text is always Thai (summary, reasons, next action, missing info): the same language rule as the model.
const STAGE_TH = { new: "ใหม่", qualified: "ผ่านการคัดกรอง", proposal: "เสนอราคา", won: "ปิดการขายได้", lost: "ปิดการขายไม่สำเร็จ" } as const;
const SOURCE_TH = { website: "เว็บไซต์", manual: "บันทึกเอง", line: "LINE" } as const;

const BASE_SCORE = { new: 30, qualified: 50, proposal: 65, won: 100, lost: 0 } as const;

export function scoreFromRules(ctx: AiContext): { score: number; reasons: string[] } {
  const { lead } = ctx;
  if (lead.stage === "won") return { score: 100, reasons: ["ดีลนี้ปิดการขายได้แล้ว"] };
  if (lead.stage === "lost") return { score: 0, reasons: ["ดีลนี้ปิดการขายไม่สำเร็จแล้ว"] };
  let score: number = BASE_SCORE[lead.stage];
  const reasons = [`ขั้นตอนปัจจุบัน: ${STAGE_TH[lead.stage]}`];
  const adjust = (delta: number, reason: string) => {
    score += delta;
    reasons.push(reason);
  };
  if (lead.valueThb >= 1_000_000) adjust(10, "มูลค่าดีลสูง");
  else if (lead.valueThb >= 100_000) adjust(5, "มูลค่าดีลปานกลาง");
  const d = lead.daysSinceLastContact;
  if (d === null) reasons.push("ยังไม่มีการติดต่อ");
  else if (d > VERY_STALE_DAYS) adjust(-25, `ไม่ได้ติดต่อมา ${d} วัน ลูกค้าเงียบไป`);
  else if (d > STALE_DAYS) adjust(-15, `ไม่ได้ติดต่อมา ${d} วัน ลูกค้าเงียบไป`);
  else if (d <= 3) adjust(5, "ติดต่อล่าสุดไม่นาน");
  if (lead.hasUnansweredInbound) adjust(10, "ลูกค้ากำลังรอการตอบกลับ");
  return { score: clamp(score, 0, 100), reasons: reasons.slice(0, 5) };
}

export function templateReply(ctx: AiContext, asksBudget: boolean): string {
  const name = firstName(ctx.contact.fullName);
  if (ctx.locale === "th") {
    const p = ctx.politeParticle;
    const q = p === "ค่ะ" ? "คะ" : "ครับ";
    return asksBudget
      ? `สวัสดี${p} คุณ${name} ขอบคุณที่ติดต่อเข้ามา${p} รบกวนขอทราบงบประมาณและกรอบเวลาโดยประมาณ เพื่อให้ทีมงานเตรียมข้อมูลที่เหมาะสมให้${p} ทางเซลส์จะเป็นผู้ยืนยันรายละเอียดอีกครั้ง${p}`
      : `สวัสดี${p} คุณ${name} ขอติดตามความคืบหน้าเรื่องที่เราคุยกันไว้${p} สะดวกให้ทีมงานโทรกลับช่วงไหนบ้าง${q}`;
  }
  return asksBudget
    ? `Hi ${name}, thank you for reaching out. Could you share your rough budget and timeline so we can prepare the right information? A member of our team will confirm the details with you.`
    : `Hi ${name}, I wanted to follow up on our earlier conversation. When would be a good time for our team to call you?`;
}

/** Safe neutral reply: no price, no discount, no promise. Replaces a draft that broke a guardrail. */
export function neutralReply(ctx: AiContext): string {
  const name = firstName(ctx.contact.fullName);
  if (ctx.locale === "th") {
    const p = ctx.politeParticle;
    return `สวัสดี${p} คุณ${name} ขอบคุณที่ติดต่อเข้ามา${p} ทางเซลส์จะติดต่อกลับเพื่อยืนยันรายละเอียดให้อีกครั้ง${p}`;
  }
  return `Hi ${name}, thank you for reaching out. A member of our team will get back to you to confirm the details.`;
}

export function missingInfoFromRules(ctx: AiContext): string[] {
  const out: string[] = [];
  if (ctx.lead.valueThb === 0) out.push("งบประมาณหรือมูลค่าดีล");
  if (ctx.events.length === 0) out.push("ประวัติการสนทนา");
  if (!ctx.company) out.push("บริษัท");
  if (ctx.lead.daysSinceLastContact === null) out.push("วันที่ติดต่อล่าสุด");
  return out.slice(0, 5);
}

export function ruleBasedSuggestion(ctx: AiContext): SuggestionOutput {
  const { lead } = ctx;
  const { score, reasons } = scoreFromRules(ctx);
  const terminal = lead.stage === "won" || lead.stage === "lost";
  const days = lead.daysSinceLastContact;

  let type: SuggestionOutput["nextBestAction"]["type"];
  let detail: string;
  let dueInDays: number;
  if (terminal && !lead.newestEventIsInbound) {
    type = "wait";
    detail = `ดีลนี้${STAGE_TH[lead.stage]}แล้ว ไม่ต้องดำเนินการเพิ่ม`;
    dueInDays = 0;
  } else if (lead.hasUnansweredInbound) {
    type = lead.source === "line" ? "line_reply" : "call";
    detail = "ลูกค้ากำลังรอการตอบกลับ ควรตอบกลับวันนี้";
    dueInDays = 0;
  } else if (lead.stage === "proposal" && days !== null && days >= GIVE_UP_DAYS) {
    type = "close_lost";
    detail = `ไม่มีการตอบกลับ ${days} วันหลังส่งใบเสนอราคา พิจารณาปิดดีลว่าไม่สำเร็จ`;
    dueInDays = 2;
  } else if (lead.stage === "proposal" && days !== null && days >= STALE_DAYS) {
    type = "call";
    detail = `ใบเสนอราคาเงียบมา ${days} วันแล้ว โทรติดตามสถานะ`;
    dueInDays = 1;
  } else if (lead.stage === "qualified" && days !== null && days <= STALE_DAYS) {
    type = "send_proposal";
    detail = "ลูกค้าผ่านการคัดกรองแล้ว จัดทำและส่งใบเสนอราคา";
    dueInDays = 3;
  } else if (lead.stage === "proposal") {
    type = "wait";
    detail = "ส่งใบเสนอราคาแล้วและติดต่อล่าสุดไม่นาน รอการตอบกลับจากลูกค้า";
    dueInDays = 3;
  } else {
    type = "call";
    detail = "ติดต่อเพื่อคัดกรองลูกค้า";
    dueInDays = 2;
  }

  const draftReply = terminal && !lead.newestEventIsInbound ? null : templateReply(ctx, lead.valueThb === 0 && lead.stage !== "proposal");
  const last = days === null ? "ยังไม่เคยติดต่อ" : `ติดต่อล่าสุด ${days} วันก่อน`;
  const summary = `สรุปแบบกฎอัตโนมัติ: ขั้นตอน${STAGE_TH[lead.stage]} ช่องทาง ${SOURCE_TH[lead.source]} มูลค่า ฿${lead.valueThb.toLocaleString("en-US")} ${last} มี ${ctx.events.length} เหตุการณ์ล่าสุด${lead.hasUnansweredInbound ? " ลูกค้ากำลังรอการตอบกลับ" : ""}`;

  return {
    summary,
    score,
    scoreReasons: reasons,
    nextBestAction: { type, detail, dueInDays },
    draftReply,
    confidence: "low",
    missingInfo: missingInfoFromRules(ctx),
  };
}
