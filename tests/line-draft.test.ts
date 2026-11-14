// Prefill of the "Reply on LINE" box: an accepted AI draft is offered only until a LINE message was created from it.
import { describe, expect, it } from "vitest";
import { acceptedDraftFor } from "@/lib/line-draft";

const decidedAt = new Date("2026-11-14T10:00:00Z");
const accepted = { status: "accepted", finalDraft: "สวัสดีครับ", decidedAt };
const at = (s: string) => new Date(`2026-11-14T${s}Z`);

describe("acceptedDraftFor", () => {
  it("offers the accepted draft when no outbound message exists since acceptance", () => {
    expect(acceptedDraftFor(accepted, [])).toBe("สวัสดีครับ");
    expect(acceptedDraftFor({ ...accepted, status: "edited" }, [{ kind: "message", direction: "out", at: at("09:00:00") }])).toBe("สวัสดีครับ"); // older than the acceptance
  });

  it("offers nothing after an outbound message was created since acceptance (sent, failed or any status)", () => {
    expect(acceptedDraftFor(accepted, [{ kind: "message", direction: "out", at: at("10:00:05") }])).toBe("");
  });

  it("inbound messages and activities do not count as using the draft", () => {
    expect(acceptedDraftFor(accepted, [{ kind: "message", direction: "in", at: at("10:05:00") }, { kind: "activity", at: at("10:06:00") }])).toBe(accepted.finalDraft);
  });

  it("a message with exactly the acceptance timestamp counts as used (when unsure, do not offer again)", () => {
    expect(acceptedDraftFor(accepted, [{ kind: "message", direction: "out", at: decidedAt }])).toBe("");
    expect(acceptedDraftFor(accepted, [{ kind: "message", direction: "out", at: new Date(decidedAt.getTime() - 1) }])).toBe(accepted.finalDraft);
  });

  it("offers nothing for an accepted or edited suggestion with no decidedAt", () => {
    expect(acceptedDraftFor({ ...accepted, decidedAt: null }, [])).toBe("");
    expect(acceptedDraftFor({ ...accepted, status: "edited", decidedAt: null }, [])).toBe("");
  });

  it("offers nothing for a pending, dismissed or missing suggestion", () => {
    expect(acceptedDraftFor(null, [])).toBe("");
    expect(acceptedDraftFor({ ...accepted, status: "pending", decidedAt: null }, [])).toBe("");
    expect(acceptedDraftFor({ ...accepted, status: "dismissed" }, [])).toBe("");
  });
});
