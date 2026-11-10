# ADR 006: Phase 1 dependencies

Status: accepted (approved by the Lead) · 2026-11-10

## Context
CLAUDE.md requires approval for every new dependency with name, purpose, weekly downloads and last publish date. Supply-chain risk: several packages had releases less than 48 h old.

## Decision
- Only the packages below. Versions are pinned exactly in `package.json`.
- `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080`: pnpm will not resolve any version published less than 7 days ago. That is why some versions are a patch or two behind `latest`.
- Install scripts are blocked by default. Only `esbuild` is allowed (`allowBuilds`), because it downloads its platform binary.
- shadcn/ui components are hand-copied into `src/components/ui`; we don't run the shadcn CLI.
- Two version notes: **TypeScript 6.0.3**, not 7.x, because typescript-eslint supports `<6.1`. **ESLint 9.39.5**, not 10.x, because eslint-config-next's plugins don't support 10 yet.

Weekly downloads are npm's "last week" figure, checked 2026-11-10. Publish date is for the pinned version.

| Package | Version | Why | Weekly downloads | Published |
| --- | --- | --- | --- | --- |
| next | 16.4.4 | App Router web + API framework | ~91.9 M | 2026-11-02 |
| react / react-dom | 19.3.1 | UI runtime for Next | ~252 M / ~237 M | 2026-10-14 |
| typescript (dev) | 6.0.3 | Strict typing | ~417 M | 2026-04-16 |
| tailwindcss + @tailwindcss/postcss | 4.3.4 | Styling (responsive utilities) | ~176 M / ~61 M | 2026-11-02 |
| clsx | 2.1.1 | Class name joining (shadcn) | ~164 M | 2024-04-23 |
| tailwind-merge | 3.7.0 | Merge conflicting Tailwind classes (shadcn) | ~107 M | 2026-09-12 |
| class-variance-authority | 0.7.1 | Component variants (shadcn) | ~81 M | 2024-11-26 |
| lucide-react | 1.67.0 | Icons | ~131 M | 2026-11-03 |
| radix-ui | 1.8.1 | Accessible primitives (Slot now; Dialog/Select later) | ~27 M | 2026-10-12 |
| drizzle-orm | 0.45.4 | Typed SQL + transactions | ~48.7 M | 2026-10-08 |
| drizzle-kit (dev) | 0.31.11 | Generates SQL migrations | ~42.2 M | 2026-09-21 |
| pg | 8.23.1 | Postgres driver (ADR 002) | ~95.9 M | 2026-09-30 |
| @types/pg (dev) | 8.23.1 | Types for pg | ~95.4 M | 2026-08-17 |
| @electric-sql/pglite (dev) | 0.5.14 | In-memory Postgres for tests (ADR 001) | ~40.1 M | 2026-10-31 |
| zod | 4.6.7 | Validation at every boundary + AI output | ~454 M | 2026-10-12 |
| next-auth | 4.24.15 | Demo login, roles (ADR 003) | ~9.4 M | 2026-07-20 |
| bcryptjs | 3.0.3 | Password hashing, pure JS (no native build) | ~19.7 M | 2025-11-02 |
| pino | 10.4.0 | Structured JSON logging with redaction | ~76.8 M | 2026-10-02 |
| @faker-js/faker (dev) | 10.6.0 | Synthetic Thai seed data (`th` locale) | ~24.8 M | 2026-08-14 |
| vitest (dev) | 5.1.0 | Test runner | ~180 M | 2026-11-02 |
| tsx (dev) | 4.23.15 | Run TS scripts (seed, migrate) | ~139 M | 2026-09-20 |
| eslint (dev) | 9.39.5 | Linting | ~204 M (all majors) | 2026-07-10 |
| eslint-config-next (dev) | 16.4.4 | Next lint rules, same version as next | ~47.7 M | 2026-11-02 |
| @types/node, @types/react, @types/react-dom (dev) | 24.19.2 / 19.3.0 / 19.3.0 | Types (Node types held at 24.x LTS; `engines.node` is >=22) | ~627 M / ~226 M / ~191 M | 2026-10-09 / 2026-09-09 / 2026-09-09 |

Re-check any row with `pnpm view <pkg> time`.

## Trade-offs
- Holding back 7 days means we sometimes lag a security patch by a few days; if an urgent CVE fix lands, override for that one package with `pnpm add pkg@x.y.z` and note it here.
