// Polite-particle normaliser. The reply speaks for the lead owner, so it must use the owner's
// particle only. A model sometimes copies the customer's particle ("สวัสดีครับ … ค่ะ … ได้ไหมคะ").
// This rewrites the OTHER particle in code (not in the prompt). Pure.
//
// - Owner says ค่ะ: every ครับ becomes ค่ะ, except question endings (ไหมครับ, หรือเปล่าครับ, อะไรครับ,
//   นะครับ, anything before "?") which become คะ.
// - Owner says ครับ: ค่ะ / ค๊ะ / คะ become ครับ.
// Words that merely contain คะ (คะแนน, คะเน, คะยั้นคะยอ, คะนอง) are never touched.
// Not handled (listed in SKILL.md): other particles (จ้ะ, จ้า, นะจ๊ะ), and a question whose last word
// is not in the list below, which gets ค่ะ instead of คะ.

const QUESTION_WORDS = [
  "ไหม",
  "มั้ย",
  "มั๊ย",
  "หรือเปล่า",
  "หรือไม่",
  "หรือยัง",
  "เหรอ",
  "หรอ",
  "บ้าง",
  "อะไร",
  "ไหน",
  "เท่าไหร่",
  "เท่าไร",
  "ยังไง",
  "อย่างไร",
  "เมื่อไหร่",
  "เมื่อไร",
  "ใคร",
  "นะ",
].join("|");

const MALE_AFTER_QUESTION_WORD = new RegExp(`(${QUESTION_WORDS})ครับ`, "g");
const MALE_BEFORE_QUESTION_MARK = /ครับ(?=\s*[?？])/g;
const FEMALE_OR_KA = /ค่ะ|ค๊ะ|คะ(?!แนน|เน|ยั้น|ยั้ง|ยอ|นอง|น้า|นึง|มำ)/g;

const PRIVATE_USE = /[-]/; // no g flag: safe with .test
const PRIVATE_USE_ALL = /[-]/g;

function rewrite(draft: string, particle: "ครับ" | "ค่ะ"): string {
  if (particle === "ค่ะ") {
    return draft
      .replace(/ครับผม/g, "ค่ะ")
      .replace(MALE_AFTER_QUESTION_WORD, "$1คะ")
      .replace(MALE_BEFORE_QUESTION_MARK, "คะ")
      .replace(/ครับ/g, "ค่ะ");
  }
  return draft.replace(FEMALE_OR_KA, "ครับ");
}

/**
 * Rewrites the other polite particle. `protectedText` (the contact's and company's names) is masked
 * while rewriting and restored after, so a name such as คะนึงนิจ is never turned into ครับนึงนิจ.
 * Each name and each space-separated part of it (2+ characters) is protected.
 */
export function normalizeParticles(draft: string, particle: "ครับ" | "ค่ะ", protectedText: Array<string | null | undefined> = []): string {
  const parts = new Set<string>();
  for (const text of protectedText) {
    const t = text?.trim();
    if (!t || t.length < 2) continue; // a 1-character "name" could sit inside a particle (ค inside ค่ะ)
    parts.add(t);
    for (const word of t.split(/\s+/)) if (word.length >= 2) parts.add(word);
  }
  // Longest first so a full name is masked before its parts. Each mask is ONE private-use character (no digits, so a
  // mask can never contain another protected text such as "10"); private-use characters never match the particle regexes.
  // A protected text that itself contains a private-use character is not protected (it could collide with a mask).
  const masks = [...parts]
    .filter((text) => !PRIVATE_USE.test(text))
    .sort((a, b) => b.length - a.length)
    .slice(0, 6000) // masks use U+E100.., the private-use area has 6,400 code points
    .map((text, i) => ({ text, mask: String.fromCharCode(0xe100 + i) }));
  // Private-use characters in the draft would be "restored" into a name: drop them (Thai text never uses them).
  let masked = draft.replace(PRIVATE_USE_ALL, "");
  for (const { text, mask } of masks) masked = masked.split(text).join(mask);
  let result = rewrite(masked, particle);
  for (const { text, mask } of [...masks].reverse()) result = result.split(mask).join(text); // undo in reverse order
  return result;
}
