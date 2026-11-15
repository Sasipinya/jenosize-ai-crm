// GET /api/health: shape, simulated-AI-down flag, 503 when the DB fails, nothing secret or detailed in the body.
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appSettings } from "@/server/db/schema";
import type { Db } from "@/server/db/client";
import { checkHealth } from "@/server/services/health";
import { createTestDb, type TestDb } from "./helpers/test-db";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("checkHealth", () => {
  it("reports ok with adapters, model and a short git sha", async () => {
    const { httpStatus, body } = await checkHealth(() => t.db, { VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" });
    expect(httpStatus).toBe(200);
    expect(body).toEqual({
      status: "ok",
      db: "ok",
      ai: { adapter: "mock", model: "mock", configured: true, simulatedDown: false },
      line: { adapter: "mock", configured: true },
      version: "0123456",
    });
  });

  it("version is null without a git sha", async () => {
    expect((await checkHealth(() => t.db, {})).body.version).toBeNull();
  });

  it("shows the simulate_ai_down switch", async () => {
    await t.db.insert(appSettings).values({ key: "simulate_ai_down", value: true }).onConflictDoUpdate({ target: appSettings.key, set: { value: true } });
    expect((await checkHealth(() => t.db, {})).body.ai.simulatedDown).toBe(true);
    await t.db.update(appSettings).set({ value: false }).where(eq(appSettings.key, "simulate_ai_down"));
  });

  it("degraded (still 200) when a real adapter is selected without its key; the key is never echoed", async () => {
    const env = { AI_ADAPTER: "claude", AI_MODEL: "claude-haiku-5-5", ANTHROPIC_API_KEY: "replace-with-your-key", LINE_ADAPTER: "real", LINE_CHANNEL_ACCESS_TOKEN: "super-secret-token", LINE_CHANNEL_SECRET: "replace-with-your-secret" };
    const { httpStatus, body } = await checkHealth(() => t.db, env);
    expect(httpStatus).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.ai).toMatchObject({ adapter: "claude", model: "claude-haiku-5-5", configured: false });
    expect(body.line).toEqual({ adapter: "real", configured: false }); // token set, channel secret is still the placeholder
    expect(JSON.stringify(body)).not.toMatch(/replace-with|super-secret/);
  });

  it("503 with db: error when the database throws, without the error text", async () => {
    const broken = { execute: () => Promise.reject(new Error("connect ECONNREFUSED postgres://user:pw@host/db")) } as unknown as Db;
    const { httpStatus, body } = await checkHealth(() => broken, {});
    expect(httpStatus).toBe(503);
    expect(body.status).toBe("error");
    expect(body.db).toBe("error");
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|postgres:|pw@/);
  });

  it("503 when DATABASE_URL is not set (getDb throws)", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { GET } = await import("@/app/api/health/route");
      const res = await GET();
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await res.json()).db).toBe("error");
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});

describe("/api/health is public", () => {
  it("passes the route guard without a session", async () => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-proxy-tests-only";
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("http://localhost:3000/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
