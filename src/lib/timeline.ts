// Readable labels for the lead timeline: activity types and messages, instead of raw enum names.
import type { TimelineItem } from "@/server/services/leads";

export const ACTIVITY_LABEL: Record<string, string> = {
  note: "Note",
  stage_change: "Stage changed",
  call: "Call",
  ai_accepted: "AI suggestion accepted",
  message_sent: "Message sent",
  message_received: "Message received",
  quick_reply: "Quick reply",
  consent: "Consent recorded",
  data_erased: "Personal data erased",
};

const humanize = (type: string) => {
  const s = type.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Label + body text for one timeline row. Inbound messages never show a delivery status. */
export function describeTimelineItem(item: TimelineItem): { label: string; text: string } {
  if (item.kind === "message") {
    if (item.direction === "in") return { label: "Message received", text: item.body };
    const label = item.status === "sent" ? "Message sent" : `Message ${item.status}`; // draft / approved / failed
    return { label, text: item.body };
  }
  const p = item.payload;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (item.type) {
    case "stage_change":
      return { label: ACTIVITY_LABEL.stage_change!, text: `${str(p.from)} → ${str(p.to)}${p.lostReason ? ` (reason: ${str(p.lostReason)})` : ""}` };
    case "note":
      return { label: p.system ? "System" : ACTIVITY_LABEL.note!, text: str(p.text) };
    case "ai_accepted": {
      const edited = p.status === "edited";
      const bits = [typeof p.score === "number" ? `score ${p.score}` : "", p.nextAction ? `next: ${str(p.nextAction).replaceAll("_", " ")}` : ""].filter(Boolean);
      return { label: edited ? "AI suggestion accepted with edits" : ACTIVITY_LABEL.ai_accepted!, text: bits.join(", ") };
    }
    default:
      return { label: ACTIVITY_LABEL[item.type] ?? humanize(item.type), text: str(p.text) };
  }
}
