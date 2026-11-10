# AI CRM (Jenosize take-home)

Internal AI CRM MVP for a 20-person commercial team: leads, companies, contacts, pipeline, AI copilot and LINE OA.
Synthetic data only. Full README (trade-offs, limitations, LINE test steps, hours log) comes in Phase 5.

## Quick start

Needs Node 22+, pnpm, and any Postgres URL (Neon free tier works). No Docker.

```bash
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL and NEXTAUTH_SECRET
pnpm db:setup                # migrate + seed (note: not `pnpm setup`, see docs/adr/005)
pnpm dev
```

Checks: `pnpm lint && pnpm typecheck && pnpm test` (tests use in-memory pglite; no DB or secrets needed).

## Demo credentials

Demo-only password, public on purpose (docs/adr/004). It does not match any real password.

| Role | Email | Password |
| --- | --- | --- |
| admin | `admin@example.com` | `DemoCRM-2026!` |
| sales | `sales@example.com` | `DemoCRM-2026!` |

## Docs

- Deploy (Neon + Vercel): [docs/deploy.md](docs/deploy.md)
- Plan: [docs/plan.md](docs/plan.md) · Assumptions: [docs/discovery.md](docs/discovery.md) · Decisions: [docs/adr/](docs/adr/)
