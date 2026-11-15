// The AI-panel note for a "not interested" tap: code-side, newest tap wins.
import { describe, expect, it } from "vitest";
import { latestTapAction, NOT_INTERESTED_NOTICE, tapNotice } from "@/lib/tap-notice";

const at = (d: number) => new Date(`2026-11-${String(10 + d).padStart(2, "0")}T00:00:00Z`);
const tap = (day: number, action: string, scoreChanged = true) => ({ kind: "activity", at: at(day), type: "quick_reply", payload: { action, scoreChanged } });
const msg = (day: number) => ({ kind: "message", at: at(day) });

describe("tapNotice", () => {
  it("the note text is exactly the agreed Thai sentence", () => {
    expect(NOT_INTERESTED_NOTICE).toBe("ลูกค้ากด 'ไม่สนใจ' — ตรวจสอบก่อนส่งข้อความ");
  });

  it("shows when the latest tap is not_interested, whatever the list order", () => {
    expect(tapNotice([tap(1, "book_call"), tap(2, "not_interested")])).toBe(NOT_INTERESTED_NOTICE);
    expect(tapNotice([tap(2, "not_interested"), tap(1, "book_call")])).toBe(NOT_INTERESTED_NOTICE); // newest-first, like the lead page
  });

  it("a repeat not_interested tap (score unchanged) still counts as the latest tap", () => {
    expect(tapNotice([tap(1, "not_interested"), tap(2, "not_interested", false)])).toBe(NOT_INTERESTED_NOTICE);
  });

  it("goes away when the customer taps another button afterwards", () => {
    expect(tapNotice([tap(1, "not_interested"), tap(2, "book_call")])).toBeNull();
    expect(latestTapAction([tap(1, "not_interested"), tap(2, "book_call")])).toBe("book_call");
  });

  it("no taps, other buttons only, messages only, or a tap without an action: no note", () => {
    expect(tapNotice([])).toBeNull();
    expect(tapNotice([tap(1, "book_call"), tap(2, "request_quote")])).toBeNull();
    expect(tapNotice([msg(1), msg(2)])).toBeNull();
    expect(tapNotice([{ kind: "activity", at: at(1), type: "quick_reply", payload: {} }])).toBeNull();
  });

  it("a message after the tap does not clear the note", () => {
    expect(tapNotice([tap(1, "not_interested"), msg(2)])).toBe(NOT_INTERESTED_NOTICE);
  });
});
