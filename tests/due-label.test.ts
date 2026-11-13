import { describe, expect, it } from "vitest";
import { dueLabel, isThaiText } from "@/lib/due-label";

describe("dueLabel", () => {
  it("English", () => {
    expect(dueLabel(0, false)).toBe("today");
    expect(dueLabel(1, false)).toBe("tomorrow");
    expect(dueLabel(2, false)).toBe("within 2 days");
    expect(dueLabel(60, false)).toBe("within 60 days");
  });

  it("Thai", () => {
    expect(dueLabel(0, true)).toBe("วันนี้");
    expect(dueLabel(1, true)).toBe("พรุ่งนี้");
    expect(dueLabel(2, true)).toBe("ภายใน 2 วัน");
    expect(dueLabel(60, true)).toBe("ภายใน 60 วัน");
  });
});

describe("isThaiText", () => {
  it("detects a Thai draft or summary", () => {
    expect(isThaiText("สวัสดีครับ คุณสมชาย ขอบคุณที่ติดต่อเข้ามาครับ")).toBe(true);
    expect(isThaiText(null, "สรุป: ลูกค้าสนใจแพ็กเกจ")).toBe(true);
  });

  it("is English for English text, null and undefined", () => {
    expect(isThaiText("Hi John, thank you for reaching out.")).toBe(false);
    expect(isThaiText(null, "Hello")).toBe(false);
    expect(isThaiText(null, undefined)).toBe(false);
    expect(isThaiText(undefined)).toBe(false);
  });

  it("does not treat the baht sign or Thai digits as Thai (fallback summaries always contain ฿)", () => {
    expect(isThaiText(null, "Rule-based summary: stage new, value ฿50,000, last contact 3 days ago.")).toBe(false);
    expect(isThaiText("Hi John, the budget is ฿๕๐,๐๐๐.")).toBe(false);
  });

  it("keeps an English reply English when it only contains a Thai name", () => {
    expect(isThaiText("Hi สมชาย, thank you for reaching out. Could you share your budget and timeline?")).toBe(false);
  });

  it("uses the draft reply, not the summary, when there is a draft", () => {
    expect(isThaiText("Hi John, we will call you today.", "ลูกค้าสนใจแพ็กเกจรายปี")).toBe(false);
  });
});
