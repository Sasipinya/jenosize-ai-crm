// Fixed PDPA privacy notice and Quick Reply buttons. Plain templates: no AI, no customer content, no polite particle.
// See docs/pdpa-line-notice.md for why this one automatic reply is allowed and what it does not cover.

export const PRIVACY_NOTICE_VERSION = "2026-11-v1";

const NOTICE_TEMPLATE =
  "ขอบคุณที่ติดต่อเรา ข้อมูลที่ส่งผ่าน LINE จะใช้เพื่อตอบคำถามและติดต่อกลับเรื่องบริการเท่านั้น อ่านนโยบายความเป็นส่วนตัวได้ที่ {APP_URL}/privacy หากต้องการให้ลบข้อมูล แจ้งในแชทนี้ได้ทุกเมื่อ";

/** APP_URL, else NEXTAUTH_URL (the same public URL on Vercel), else localhost. No trailing slash. */
export function appUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.APP_URL || env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function privacyNoticeText(env: Record<string, string | undefined> = process.env): string {
  return NOTICE_TEMPLATE.replace("{APP_URL}", appUrl(env));
}

export const QUICK_REPLY_ACTIONS = ["book_call", "request_quote", "not_interested"] as const;
export type QuickReplyAction = (typeof QUICK_REPLY_ACTIONS)[number];

/** `delta` is added to the lead score (clamped to 0-100; a lead with no score starts from SCORE_BASELINE). */
export const QUICK_REPLIES: Record<QuickReplyAction, { label: string; delta: number }> = {
  book_call: { label: "นัดคุย", delta: 10 },
  request_quote: { label: "ขอใบเสนอราคา", delta: 15 },
  not_interested: { label: "ไม่สนใจ", delta: -20 },
};
export const SCORE_BASELINE = 50;

export const postbackData = (action: QuickReplyAction, messageId: string) => `action=${action}&mid=${messageId}`;

/** Parses postback data. Unknown actions return null: customer-controlled data is never trusted. */
export function parsePostback(data: string): { action: QuickReplyAction; messageId: string | null } | null {
  const p = new URLSearchParams(data);
  const action = p.get("action");
  if (!QUICK_REPLY_ACTIONS.includes(action as QuickReplyAction)) return null;
  const mid = p.get("mid");
  return { action: action as QuickReplyAction, messageId: mid && /^[0-9a-f-]{36}$/i.test(mid) ? mid : null };
}
