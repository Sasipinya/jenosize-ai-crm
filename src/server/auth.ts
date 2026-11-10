// NextAuth (v4) config: Credentials provider over seeded demo users, JWT sessions (8 h).
// Also exports server helpers to read/require the session in pages and route handlers.
import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { redirect } from "next/navigation";
import { getDb } from "./db/client";
import { verifyCredentials, type SessionUser } from "./services/users";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Demo login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => verifyCredentials(getDb(), credentials),
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      // `user` is only present right after sign-in.
      if (user) {
        const u = user as SessionUser;
        token.sub = u.id;
        token.role = u.role;
        token.politeParticle = u.politeParticle;
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        id: token.sub!,
        name: token.name ?? "",
        email: token.email ?? "",
        role: token.role,
        politeParticle: token.politeParticle,
      };
      return session;
    },
  },
};

export async function getSessionUser() {
  const session = await getServerSession(authOptions);
  return session?.user ?? null;
}

/** For server components/pages: redirect to /login when there is no session. */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
