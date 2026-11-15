// Builds the model's input from a lead. Pure (no DB, no network): strips phone/email, trims long
// messages, keeps the 20 newest events, and works out the facts the prompt needs.
import { MAX_FIELD_CHARS, redactPii } from "../../../skills/crm-copilot/redact";
import type { AiContext, AiEvent } from "../../../skills/crm-copilot/schema";
import { QUICK_REPLIES, type QuickReplyAction } from "./line/notice";
import type { TimelineItem } from "./leads";

export const MAX_EVENTS = 20;
export const MAX_TEXT_CHARS = 500;
const DAY_MS = 86_400_000;

// Redaction lives in skills/crm-copilot/redact.ts so the prompt renderer can apply it too.
export { MAX_FIELD_CHARS, redactPii };

export function trimText(text: string, max = MAX_TEXT_CHARS): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…[trimmed]`;
}

export const sanitize = (text: string) => trimText(redactPii(text));

const THAI = /[฀-๿]/;
const daysBetween = (later: Date, earlier: Date) => Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / DAY_MS));

export type BuildInput = {
  lead: { title: string; stage: AiContext["lead"]["stage"]; source: AiContext["lead"]["source"]; valueThb: number; stageChangedAt: Date };
  contact: { fullName: string };
  company: { name: string; industry: string | null } | null;
  timeline: TimelineItem[];
  politeParticle: AiContext["politeParticle"];
  fewShot?: string[];
  locale?: AiContext["locale"];
  now?: Date;
};

type Row = { at: Date; ev: AiEvent; inbound: boolean; outbound: boolean; contact: boolean };

/** Maps timeline rows to events. System noise (lead created/updated, AI/consent audit rows) is dropped. */
function toRows(timeline: TimelineItem[], now: Date): Row[] {
  const rows: Row[] = [];
  for (const item of timeline) {
    const daysAgo = daysBetween(now, item.at);
    if (item.kind === "message") {
      if (item.direction === "out" && item.status !== "sent" && item.status !== "approved") continue; // drafts are not contact
      const inbound = item.direction === "in";
      rows.push({
        at: item.at,
        ev: { kind: inbound ? "customer_message" : "outbound_message", daysAgo, text: sanitize(item.body) },
        inbound,
        outbound: !inbound,
        contact: true,
      });
      continue;
    }
    const p = item.payload;
    const text = typeof p.text === "string" ? p.text : "";
    if (item.type === "note" && p.system === true) {
      if (p.source !== "website") continue;
      rows.push({ at: item.at, ev: { kind: "customer_enquiry", daysAgo, text: sanitize(text) }, inbound: true, outbound: false, contact: true });
    } else if (item.type === "note") {
      rows.push({ at: item.at, ev: { kind: "note", daysAgo, text: sanitize(text) }, inbound: false, outbound: false, contact: true });
    } else if (item.type === "call") {
      rows.push({ at: item.at, ev: { kind: "call", daysAgo, text: sanitize(text) }, inbound: false, outbound: true, contact: true });
    } else if (item.type === "quick_reply") {
      // A button tap is a customer signal. The text is built from OUR fixed label, never from customer free text.
      // Repeat taps (score unchanged) add nothing, so they are skipped.
      const action = typeof p.action === "string" && p.action in QUICK_REPLIES ? (p.action as QuickReplyAction) : null;
      if (action && p.scoreChanged === true) {
        rows.push({ at: item.at, ev: { kind: "customer_action", daysAgo, text: `Customer tapped the quick-reply button "${QUICK_REPLIES[action].label}" (${action})` }, inbound: false, outbound: false, contact: false });
      }
    } else if (item.type === "stage_change") {
      const reason = typeof p.lostReason === "string" ? ` (reason: ${sanitize(p.lostReason)})` : "";
      rows.push({ at: item.at, ev: { kind: "stage_change", daysAgo, text: `${String(p.from)} → ${String(p.to)}${reason}` }, inbound: false, outbound: false, contact: false });
    }
  }
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Newest real activity/message time. Ignores ai_accepted so accepting a suggestion does not invalidate the cache. */
export function latestEventAt(timeline: TimelineItem[]): Date | null {
  let max: Date | null = null;
  for (const item of timeline) {
    if (item.kind === "activity" && item.type === "ai_accepted") continue;
    if (!max || item.at > max) max = item.at;
  }
  return max;
}

export function buildContext(input: BuildInput): AiContext {
  const now = input.now ?? new Date();
  const rows = toRows(input.timeline, now);
  const recent = rows.slice(-MAX_EVENTS);

  const lastContact = [...rows].reverse().find((r) => r.contact);
  const lastInbound = [...rows].reverse().find((r) => r.inbound);
  const lastOutbound = [...rows].reverse().find((r) => r.outbound);
  const newest = rows.at(-1);

  const name = redactPii(input.contact.fullName);
  const locale =
    input.locale ?? (THAI.test(name) || recent.some((r) => r.inbound && THAI.test(r.ev.text)) ? "th" : "en");

  return {
    lead: {
      title: trimText(redactPii(input.lead.title), 200),
      stage: input.lead.stage,
      source: input.lead.source,
      valueThb: input.lead.valueThb,
      daysInStage: daysBetween(now, input.lead.stageChangedAt),
      daysSinceLastContact: lastContact ? daysBetween(now, lastContact.at) : null,
      hasUnansweredInbound: !!lastInbound && (!lastOutbound || lastInbound.at > lastOutbound.at),
      newestEventIsInbound: !!newest && newest.inbound && newest.ev.kind === "customer_message",
    },
    contact: { fullName: name },
    company: input.company
      ? { name: redactPii(input.company.name), industry: input.company.industry ? redactPii(input.company.industry) : null }
      : null,
    events: recent.map((r) => r.ev),
    locale,
    politeParticle: input.politeParticle,
    fewShot: (input.fewShot ?? []).slice(0, 3).map(sanitize),
  };
}
