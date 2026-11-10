// NextAuth endpoints (sign-in, sign-out, session, CSRF). Config lives in src/server/auth.ts.
import NextAuth from "next-auth";
import { authOptions } from "@/server/auth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
