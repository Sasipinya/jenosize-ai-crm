// Zod schemas for the LINE endpoints. The webhook schema is loose on purpose: LINE adds fields over time,
// and we only read the few we need. Everything else is stored untouched in line_events.raw.
import { z } from "zod";

export const lineEventSchema = z.looseObject({
  type: z.string(),
  webhookEventId: z.string().min(1).max(100),
  source: z.looseObject({ userId: z.string().min(1).max(100).optional() }).optional(),
  message: z.looseObject({ id: z.string().optional(), type: z.string(), text: z.string().optional() }).optional(),
  postback: z.looseObject({ data: z.string().max(300) }).optional(),
});
export const lineWebhookSchema = z.looseObject({ events: z.array(lineEventSchema).max(100) });

export type LineEvent = z.infer<typeof lineEventSchema>;

/** A salesperson approves and sends a LINE message. The click is the approval. */
export const sendMessageSchema = z.strictObject({
  leadId: z.uuid(),
  body: z.string().trim().min(1, "Message is empty").max(1000),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
