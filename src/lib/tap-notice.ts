// A quick-reply tap the salesperson must not miss. Code-side only: no model call, no data written.

export const NOT_INTERESTED_NOTICE = "ลูกค้ากด 'ไม่สนใจ' — ตรวจสอบก่อนส่งข้อความ";

type TimelineLike = { kind: string; at: Date; type?: string; payload?: Record<string, unknown> };

/** The button of the NEWEST quick_reply activity (a repeat tap counts), or null when the customer never tapped one. */
export function latestTapAction(timeline: TimelineLike[]): string | null {
  let newest: TimelineLike | null = null;
  for (const item of timeline) {
    if (item.kind !== "activity" || item.type !== "quick_reply") continue;
    if (!newest || item.at > newest.at) newest = item;
  }
  const action = newest?.payload?.action;
  return typeof action === "string" ? action : null;
}

/** The note for the AI panel: only when the latest tap is "not interested". A later tap on another button clears it. */
export const tapNotice = (timeline: TimelineLike[]): string | null => (latestTapAction(timeline) === "not_interested" ? NOT_INTERESTED_NOTICE : null);
