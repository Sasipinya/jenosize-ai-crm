// crm-copilot: Zod output schema and the (already PII-stripped) context type. Pure: only imports zod.
import { z } from "zod";

export const ACTION_TYPES = ["call", "line_reply", "send_proposal", "wait", "close_lost"] as const;
export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export const suggestionOutputSchema = z.strictObject({
  summary: z.string().trim().min(1).max(600),
  score: z.number().int().min(0).max(100),
  scoreReasons: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
  nextBestAction: z.strictObject({
    type: z.enum(ACTION_TYPES),
    detail: z.string().trim().min(1).max(300),
    dueInDays: z.number().int().min(0).max(60),
  }),
  draftReply: z.string().trim().min(1).max(1000).nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  missingInfo: z.array(z.string().trim().min(1).max(200)).max(5),
});

export type SuggestionOutput = z.infer<typeof suggestionOutputSchema>;

export type AiEventKind = "customer_message" | "customer_enquiry" | "outbound_message" | "note" | "call" | "stage_change" | "customer_action";

/** One timeline entry. `text` is already redacted (no phone/email) and trimmed. */
export type AiEvent = { kind: AiEventKind; daysAgo: number; text: string };

export type AiContext = {
  lead: {
    title: string;
    stage: "new" | "qualified" | "proposal" | "won" | "lost";
    source: "website" | "manual" | "line";
    valueThb: number;
    daysInStage: number;
    /** Days since the last real contact (call, note, inbound or sent message). null = never. */
    daysSinceLastContact: number | null;
    /** The newest customer message/enquiry is newer than our newest outbound message or call. */
    hasUnansweredInbound: boolean;
    /** The single newest event is an inbound customer message. */
    newestEventIsInbound: boolean;
  };
  /** Name only: no phone, email or LINE id ever reaches the model. */
  contact: { fullName: string };
  company: { name: string; industry: string | null } | null;
  /** Up to 20, oldest first. */
  events: AiEvent[];
  locale: "th" | "en";
  politeParticle: "ครับ" | "ค่ะ";
  /** Up to 3 final replies a human accepted or edited. Never dismissed ones. */
  fewShot: string[];
};
