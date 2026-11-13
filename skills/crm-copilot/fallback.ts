// Rule-based fallback: deterministic, no network, always schema-valid. Used when the LLM fails,
// times out, is not configured, or the admin toggle simulate_ai_down is on.
import type { AiContext, SuggestionOutput } from "./schema";

const STALE_DAYS = 14;
const VERY_STALE_DAYS = 30;
const GIVE_UP_DAYS = 45;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

const BASE_SCORE = { new: 30, qualified: 50, proposal: 65, won: 100, lost: 0 } as const;

export function scoreFromRules(ctx: AiContext): { score: number; reasons: string[] } {
  const { lead } = ctx;
  if (lead.stage === "won") return { score: 100, reasons: ["Lead is won"] };
  if (lead.stage === "lost") return { score: 0, reasons: ["Lead is lost"] };
  let score: number = BASE_SCORE[lead.stage];
  const reasons = [`Stage is ${lead.stage}`];
  const adjust = (delta: number, reason: string) => {
    score += delta;
    reasons.push(reason);
  };
  if (lead.valueThb >= 1_000_000) adjust(10, "High deal value");
  else if (lead.valueThb >= 100_000) adjust(5, "Medium deal value");
  const d = lead.daysSinceLastContact;
  if (d === null) reasons.push("No contact recorded yet");
  else if (d > VERY_STALE_DAYS) adjust(-25, `No contact for ${d} days: gone quiet`);
  else if (d > STALE_DAYS) adjust(-15, `No contact for ${d} days: gone quiet`);
  else if (d <= 3) adjust(5, "Recent contact");
  if (lead.hasUnansweredInbound) adjust(10, "Customer is waiting for a reply");
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
  if (ctx.lead.valueThb === 0) out.push("Budget or deal value");
  if (ctx.events.length === 0) out.push("Conversation history");
  if (!ctx.company) out.push("Company");
  if (ctx.lead.daysSinceLastContact === null) out.push("Last contact date");
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
    detail = `Lead is ${lead.stage}; no action needed.`;
    dueInDays = 0;
  } else if (lead.hasUnansweredInbound) {
    type = lead.source === "line" ? "line_reply" : "call";
    detail = "Customer is waiting for a reply. Respond today.";
    dueInDays = 0;
  } else if (lead.stage === "proposal" && days !== null && days >= GIVE_UP_DAYS) {
    type = "close_lost";
    detail = `No response for ${days} days after the proposal. Consider closing as lost.`;
    dueInDays = 2;
  } else if (lead.stage === "proposal" && days !== null && days >= STALE_DAYS) {
    type = "call";
    detail = `Proposal has been quiet for ${days} days. Call to check status.`;
    dueInDays = 1;
  } else if (lead.stage === "qualified" && days !== null && days <= STALE_DAYS) {
    type = "send_proposal";
    detail = "Lead is qualified. Prepare and send a proposal.";
    dueInDays = 3;
  } else if (lead.stage === "proposal") {
    type = "wait";
    detail = "Proposal is out and contact is recent. Wait for the customer.";
    dueInDays = 3;
  } else {
    type = "call";
    detail = "Reach out to qualify the lead.";
    dueInDays = 2;
  }

  const draftReply = terminal && !lead.newestEventIsInbound ? null : templateReply(ctx, lead.valueThb === 0 && lead.stage !== "proposal");
  const last = days === null ? "no contact yet" : `last contact ${days} days ago`;
  const summary = `Rule-based summary: stage ${lead.stage}, source ${lead.source}, value ฿${lead.valueThb.toLocaleString("en-US")}, ${last}, ${ctx.events.length} recent events${lead.hasUnansweredInbound ? ", customer waiting for a reply" : ""}.`;

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
