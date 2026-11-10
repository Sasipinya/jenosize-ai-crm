// Type augmentation: our session and JWT carry the user id, role and polite particle.
import type { PoliteParticle, Role } from "@/server/db/schema";

declare module "next-auth" {
  interface Session {
    user: { id: string; name: string; email: string; role: Role; politeParticle: PoliteParticle };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    politeParticle: PoliteParticle;
  }
}
