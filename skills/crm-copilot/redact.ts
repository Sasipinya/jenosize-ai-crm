// PII redaction for text that goes to the LLM. Pure, no imports. Used twice on purpose:
// buildContext redacts when the context is built, and buildUserPrompt redacts again at render
// time, so a context built by hand still cannot leak a phone number or email into the prompt.

/** Each free-text field is cut to this length BEFORE redaction, which bounds regex work on hostile input. */
export const MAX_FIELD_CHARS = 5_000;

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
/** Thai digits → ASCII, en/em dash → "-". Only used to classify a match; the kept text is the original. */
const normalize = (s: string) =>
  s.replace(/[๐-๙]/g, (c) => String(THAI_DIGITS.indexOf(c))).replace(/[–—]/g, "-");

/**
 * Replaces emails and phone-like numbers (9+ digits, starting 0/+ or containing separators).
 * Thai digits (๐-๙) count as digits; en/em dashes count as hyphens. Plain budgets such as
 * 1500000, 100000-200000 or 1500000.00 survive. Known limits are listed in SKILL.md.
 */
export function redactPii(text: string): string {
  return text
    .slice(0, MAX_FIELD_CHARS)
    .replace(/[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g, "[email]")
    .replace(/\+?\(?[0-9๐-๙][0-9๐-๙\s().–—-]{6,}[0-9๐-๙]/g, (m) => {
      const a = normalize(m);
      const digitsOnly = a.replace(/\D/g, "");
      // Country code written without "+" (66 + 9-10 digits), with or without separators.
      if (/^66\d{9,10}$/.test(digitsOnly)) return "[phone]";
      // "100000-200000" budget range, "1500000.00" amount. Never exempt anything starting with 0 or +: that is a phone number.
      if (!/^[+0(]/.test(a) && (/^\d{4,}-\d{4,}$/.test(a) || /^\d+\.\d{1,2}$/.test(a))) return m;
      const looksLikePhone = /^[+0(]/.test(a) || /[\s().-]/.test(a);
      return digitsOnly.length >= 9 && looksLikePhone ? "[phone]" : m;
    });
}
