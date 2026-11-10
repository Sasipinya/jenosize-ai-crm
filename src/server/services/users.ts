// User service: credential verification for demo login. Never returns password_hash.
// Runs bcrypt even for unknown emails so response time does not reveal which emails exist.
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users, type PoliteParticle, type Role } from "../db/schema";
import { credentialsSchema } from "@/lib/validation/auth";

export type SessionUser = { id: string; email: string; name: string; role: Role; politeParticle: PoliteParticle };

// Real bcrypt hash of a random value nobody knows, made once per process; only equalises timing.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash(randomUUID(), 10));

export async function verifyCredentials(db: Db, input: unknown): Promise<SessionUser | null> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const ok = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) return null;

  return { id: user.id, email: user.email, name: user.name, role: user.role, politeParticle: user.politeParticle };
}
