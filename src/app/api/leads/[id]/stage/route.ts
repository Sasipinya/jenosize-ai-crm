// POST /api/leads/:id/stage: the only endpoint that changes a stage (writes stage_change activity).
import { z } from "zod";
import { stageChangeSchema } from "@/lib/validation/crm";
import { getDb } from "@/server/db/client";
import { ok, readJson, withAuth } from "@/server/http";
import { changeStage } from "@/server/services/leads";

export const POST = withAuth<{ id: string }>(async ({ req, user, params, requestId }) => {
  const input = stageChangeSchema.parse(await readJson(req));
  return ok(await changeStage(getDb(), user, z.uuid().parse(params.id), input), requestId);
});
