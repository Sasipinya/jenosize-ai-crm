// Audit trail writer. Always call with the same transaction as the change it records.
import { activities, type ActivityType } from "../db/schema";
import type { Tx } from "./common";

export async function addActivity(
  tx: Tx,
  input: { leadId: string; actorId: string | null; type: ActivityType; payload?: Record<string, unknown> },
) {
  const [row] = await tx
    .insert(activities)
    .values({ leadId: input.leadId, actorId: input.actorId, type: input.type, payload: input.payload ?? {} })
    .returning();
  return row!;
}
