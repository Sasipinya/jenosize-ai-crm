// The one rule for "which quick-reply taps counted toward the score", used by the postback handler and by Accept.
// A counted button is worth its QUICK_REPLIES value (นัดคุย +10, ขอใบเสนอราคา +15, ไม่สนใจ -20), once per lead.
import { describe, expect, it } from "vitest";
import { quickReplyBoost, scoredQuickReplies } from "@/server/services/line/quick-reply-score";

const tap = (action: string, scoreChanged = true) => ({ action, scoreChanged, text: "tap" });

describe("quickReplyBoost", () => {
  it("prod timeline: นัดคุย, ขอใบเสนอราคา, then นัดคุย again (score unchanged) = 25: the repeat adds nothing", () => {
    const rows = [tap("book_call"), tap("request_quote"), tap("book_call", false)];
    expect(quickReplyBoost(rows)).toBe(25);
    expect([...scoredQuickReplies(rows).keys()]).toEqual(["book_call", "request_quote"]);
  });

  it("each button counts once even if two rows are flagged scoreChanged", () => {
    expect(quickReplyBoost([tap("book_call"), tap("book_call")])).toBe(10);
  });

  it("not_interested is negative", () => {
    expect(quickReplyBoost([tap("book_call"), tap("not_interested")])).toBe(-10);
  });

  it("the value does not depend on the score when it was tapped (a clamped tap still counts in full)", () => {
    expect(quickReplyBoost([{ action: "request_quote", scoreChanged: true, scoreBefore: 95, scoreAfter: 100 }])).toBe(15);
  });

  it("ignores unknown actions, taps without scoreChanged, and nothing at all", () => {
    expect(quickReplyBoost([tap("delete_everything"), { action: "book_call" }, tap("book_call", false)])).toBe(0);
    expect(quickReplyBoost([])).toBe(0);
  });
});
