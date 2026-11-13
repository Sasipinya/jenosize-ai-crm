// Code-enforced guardrail for draft replies. Pure. The prompt asks the model not to promise offers;
// this makes it a guarantee. Two rules, no allow-list for discounts:
//
// 1. A draft may NEVER mention a discount, a promotion or a percentage. Nothing in the CRM data
//    (notes, messages, lead value) can authorise it: only a human may offer one.
// 2. A price figure in a draft is allowed only if it exactly matches the lead value or a figure in
//    one of OUR outbound messages. Customer text, notes and calls never authorise a price.
//
// Anything flagged is replaced by a neutral reply, so a false positive costs a generic draft,
// never a wrong promise. Known gaps are listed in SKILL.md.
import type { AiContext } from "./schema";

const DISCOUNT = /discount|rebate|promotion|promo(?![a-z])|half price|special price|special offer|ส่วนลด|ลดราคา|ลดให้|ราคาพิเศษ|โปรโมชั่น|โปรโมชัน|ลด\s*\d/i;
const PERCENT = /\d+(?:\.\d+)?\s*(?:%|％|percent|per\s*cent|pct|เปอร์เซ็นต์|เปอร์เซนต์|เปอร์เซ็น)|ร้อยละ\s*\d/i;

const UNIT = "(k(?![a-z])|thousand|million|พัน|หมื่น|แสน|ล้าน)?";
const NUM = "(\\d[\\d,]*(?:\\.\\d+)?)";
const AMOUNT_BEFORE_CURRENCY = new RegExp(`${NUM}\\s*${UNIT}\\s*(?:฿|บาท|baht|thb|usd|dollars?|\\$)`, "gi");
const CURRENCY_BEFORE_AMOUNT = new RegExp(`(?:฿|\\$|\\bthb|\\busd|\\bbt\\.?)\\s*${NUM}\\s*${UNIT}`, "gi");
const AMOUNT_AFTER_PRICE_WORD = new RegExp(`(?:ราคา|ค่าบริการ|price|cost|quote)\\D{0,24}?${NUM}\\s*${UNIT}`, "gi");
const ANY_AMOUNT = new RegExp(`${NUM}\\s*${UNIT}`, "gi");

const MULTIPLIER: Record<string, number> = { k: 1e3, thousand: 1e3, million: 1e6, พัน: 1e3, หมื่น: 1e4, แสน: 1e5, ล้าน: 1e6 };
const toNumber = (digits: string, unit?: string) => Number(digits.replace(/,/g, "")) * (unit ? (MULTIPLIER[unit.toLowerCase()] ?? 1) : 1);

/** Thai digits to ASCII so "๕๐,๐๐๐ บาท" is read like "50,000 บาท". */
const asciiDigits = (s: string) => s.replace(/[๐-๙]/g, (c) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(c)));

/** Prices the draft may state: the lead value and any figure in our own outbound messages (with units, "2 แสน" = 200000). */
function allowedPrices(ctx: AiContext): Set<number> {
  const set = new Set<number>();
  if (ctx.lead.valueThb > 0) set.add(ctx.lead.valueThb);
  const outbound = asciiDigits(
    ctx.events
      .filter((e) => e.kind === "outbound_message")
      .map((e) => e.text)
      .join("\n"),
  );
  for (const m of outbound.matchAll(ANY_AMOUNT)) {
    set.add(toNumber(m[1]!));
    if (m[2]) set.add(toNumber(m[1]!, m[2]));
  }
  return set;
}

/** A lone year (2026, Thai Buddhist 2569) next to a price word is a date, not a price. Known limitation: a real price in 1900-2700 with no unit slips through. */
const looksLikeYear = (v: number) => Number.isInteger(v) && v >= 1900 && v <= 2700;

/** What the draft says that it may not, or null when it is clean. */
export function unsupportedOffer(rawDraft: string, ctx: AiContext): "a percentage" | "a discount" | "a price" | null {
  const draft = asciiDigits(rawDraft);

  if (PERCENT.test(draft)) return "a percentage";
  if (DISCOUNT.test(draft)) return "a discount";

  const allowed = allowedPrices(ctx);
  const amounts: number[] = [];
  for (const re of [AMOUNT_BEFORE_CURRENCY, CURRENCY_BEFORE_AMOUNT]) {
    for (const m of draft.matchAll(re)) amounts.push(toNumber(m[1]!, m[2]));
  }
  for (const m of draft.matchAll(AMOUNT_AFTER_PRICE_WORD)) {
    const v = toNumber(m[1]!, m[2]);
    if (v >= 100 && !(looksLikeYear(v) && !m[2])) amounts.push(v); // "price ... in 2 days" and "price for 2026" are not prices
  }
  return amounts.some((a) => !allowed.has(a)) ? "a price" : null;
}
