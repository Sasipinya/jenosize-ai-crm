// Zod schemas for the AI endpoints.
import { z } from "zod";
import { AI_REJECT_REASONS } from "@/server/db/schema";
import { suggestionOutputSchema } from "../../../skills/crm-copilot/schema";

export const aiSuggestInputSchema = z.strictObject({ leadId: z.uuid() });

export const aiDecisionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("accept") }),
  z.strictObject({ action: z.literal("edit"), finalOutput: suggestionOutputSchema }),
  z.strictObject({
    action: z.literal("dismiss"),
    rejectReason: z.enum(AI_REJECT_REASONS).optional(),
    rejectNote: z.string().trim().max(500).optional(),
  }),
]);

export type AiDecisionInput = z.infer<typeof aiDecisionSchema>;
