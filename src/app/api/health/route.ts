// GET /api/health: public probe (see src/proxy.ts). Flat JSON, no requestId; 503 when the database is unreachable.
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { checkHealth } from "@/server/services/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const { httpStatus, body } = await checkHealth(getDb);
  return NextResponse.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
