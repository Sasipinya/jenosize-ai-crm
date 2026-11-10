# ADR 003: NextAuth v4 Credentials provider with JWT sessions

Status: accepted · 2026-11-10

## Context
The brief allows demo auth with documented credentials and two roles (admin, sales). The plan names Auth.js. Today's npm `latest` for `next-auth` is 4.24.15; v5 ("Auth.js") is still `5.0.0-beta.x`.

## Decision
- Use `next-auth@4.24.15` (stable; lists Next 16 as a supported peer).
- Credentials provider → `verifyCredentials()` in `src/server/services/users.ts`: Zod-validated input, lowercase email, bcrypt compare. bcrypt still runs for unknown emails, so timing does not reveal which accounts exist. One generic error message.
- JWT session strategy (required by the Credentials provider), 8 h max age. Token carries `sub` (user id), `role` and `politeParticle`. No password hash ever leaves the service.
- Guards in depth: `src/proxy.ts` (redirect / 401 JSON), then `requireUser()` in the `(crm)` layout. Phase 2 route handlers check the session again.
- Post-login redirect only accepts same-site relative paths (no open redirect).

## Trade-offs
- JWT sessions cannot be revoked server-side before expiry. Fine for a demo; production would use SSO (Google Workspace / Entra ID) or database sessions.
- No login rate limiting in the MVP.
- Moving to v5 later means changing the config shape and imports (`auth()` instead of `getServerSession`); the service and tests stay the same.
