// Demo login: correct credentials return a safe session user; wrong/unknown/invalid input returns null.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDatabase, DEMO_ADMIN_EMAIL, DEMO_SALES_EMAIL } from "@/server/db/seed";
import { verifyCredentials } from "@/server/services/users";
import { createTestDb, type TestDb } from "./helpers/test-db";

const PASSWORD = "test-demo-password";
let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { demoPassword: PASSWORD, counts: { users: 3, companies: 10, contacts: 20, leads: 8 } });
});

afterAll(async () => {
  await t.close();
});

describe("verifyCredentials", () => {
  it("logs in the demo admin and sales users with their roles", async () => {
    const admin = await verifyCredentials(t.db, { email: DEMO_ADMIN_EMAIL, password: PASSWORD });
    const sales = await verifyCredentials(t.db, { email: DEMO_SALES_EMAIL, password: PASSWORD });
    expect(admin?.role).toBe("admin");
    expect(sales?.role).toBe("sales");
    expect(["ครับ", "ค่ะ"]).toContain(sales?.politeParticle);
  });

  it("never exposes the password hash", async () => {
    const user = await verifyCredentials(t.db, { email: DEMO_SALES_EMAIL, password: PASSWORD });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("normalises email case and whitespace", async () => {
    const user = await verifyCredentials(t.db, { email: "  Sales@Example.COM ", password: PASSWORD });
    expect(user?.email).toBe(DEMO_SALES_EMAIL);
  });

  it("rejects a wrong password", async () => {
    expect(await verifyCredentials(t.db, { email: DEMO_SALES_EMAIL, password: "wrong-password" })).toBeNull();
  });

  it("rejects an unknown email and malformed input", async () => {
    expect(await verifyCredentials(t.db, { email: "nobody@example.com", password: PASSWORD })).toBeNull();
    expect(await verifyCredentials(t.db, { email: "not-an-email", password: PASSWORD })).toBeNull();
    expect(await verifyCredentials(t.db, { email: DEMO_SALES_EMAIL })).toBeNull();
    expect(await verifyCredentials(t.db, null)).toBeNull();
  });
});
