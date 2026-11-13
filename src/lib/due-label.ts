// Human label for a suggestion's dueInDays. Thai when the suggestion text is Thai.

// Thai letters, vowels and tone marks only. The block U+0E00-0E7F also holds the baht sign ฿ (U+0E3F)
// and Thai digits, which appear in English text too (the fallback summary always contains "฿").
const THAI_LETTER = /[ก-ฺเ-๎]/g;
const LATIN_LETTER = /[A-Za-z]/g;

/**
 * Thai when most of the letters in the text are Thai. Uses the draft reply when there is one
 * (that is what follows the lead's locale), otherwise the summary. A Thai name inside an
 * English sentence stays English.
 */
export function isThaiText(draftReply: string | null | undefined, summary?: string | null): boolean {
  const text = draftReply ?? summary ?? "";
  const thai = text.match(THAI_LETTER)?.length ?? 0;
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  return thai > 0 && thai >= latin * 0.5;
}

export function dueLabel(days: number, thai: boolean): string {
  if (days === 0) return thai ? "วันนี้" : "today";
  if (days === 1) return thai ? "พรุ่งนี้" : "tomorrow";
  return thai ? `ภายใน ${days} วัน` : `within ${days} days`;
}
