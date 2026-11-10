# Deploy: Neon + Vercel

You run every step here yourself. The agent never deploys or pushes (CLAUDE.md §1).

## 1. Neon (database)

1. Create a Neon project (free tier). Its default branch is `main`, used for **production**.
2. Create a branch `dev` from `main`, used for **local development**.
3. For each branch, copy two connection strings from **Connect**:
   - **Pooled** (host contains `-pooler`): this is `DATABASE_URL`. Use it for the app, and always on Vercel (ADR 002).
   - **Direct** (no `-pooler`): optional `MIGRATION_DATABASE_URL`, used only by migrations.
4. Thai search check (discovery open question 1). In the Neon SQL editor on `dev`, after step 2 below:
   ```sql
   SELECT similarity('สมชาย ใจดี', 'สมชาย');  -- expect > 0.3
   ```
   If it returns 0, tell the agent. ILIKE search still works, but fuzzy ranking needs a different approach.

## 2. Local

```bash
pnpm install
cp .env.example .env.local      # then fill in the dev-branch URLs and a NEXTAUTH_SECRET
pnpm db:setup                   # migrate + seed (skips seeding if users already exist)
pnpm dev                        # http://localhost:3000
```

Generate `NEXTAUTH_SECRET` with `openssl rand -base64 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

## 3. Production database (once)

Run migrations and the seed against the **`main`** branch from your machine. Migrations are not run during the Vercel build, so a broken migration can't take a deploy down halfway.

```bash
# PowerShell
$env:DATABASE_URL="<main pooled url>"; $env:MIGRATION_DATABASE_URL="<main direct url>"; $env:SEED_DEMO_PASSWORD="DemoCRM-2026!"; pnpm db:setup
# bash
DATABASE_URL="<main pooled url>" MIGRATION_DATABASE_URL="<main direct url>" SEED_DEMO_PASSWORD="DemoCRM-2026!" pnpm db:setup
```

Variables set in the shell win: the CLI fills in from `.env.local` only the keys that are not already set (verified with Node 26 `process.loadEnvFile`). So the command above targets `main` even if `.env.local` points at `dev`. Still, if you skip one variable, it silently falls back to the `.env.local` value. Set all three every time.

## 4. Vercel

1. Import the GitHub repo (keep it **private**). Framework: Next.js. Build command: default (`pnpm build`). Install: default (`pnpm install`).
2. Project → Settings → Environment Variables (Production):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon `main` **pooled** URL (`-pooler` host) |
   | `NEXTAUTH_SECRET` | a new random secret (not the dev one) |
   | `NEXTAUTH_URL` | your production URL, e.g. `https://<project>.vercel.app` |
   | `NEXT_TELEMETRY_DISABLED` | `1` |
   | `LOG_LEVEL` | `info` |

   `SEED_DEMO_PASSWORD` and `MIGRATION_DATABASE_URL` are **not** needed on Vercel.
3. Settings → General → Node.js version: 22.x or newer.
4. Deploy. Then open the URL → you should land on `/login`.

## 5. Gate check (Phase 1)

- [ ] `/leads` without a session redirects to `/login`
- [ ] Log in as `sales@example.com` / `DemoCRM-2026!` → Leads page shows 300 leads, 2,000 contacts, 150 companies
- [ ] Log out, log in as `admin@example.com` → role shows `admin`
- [ ] Wrong password → "อีเมลหรือรหัสผ่านไม่ถูกต้อง", no detail about which field was wrong
- [ ] Refresh and redeploy → data is still there (Neon, not memory)
- [ ] Phone width (375px): bottom tab bar, no horizontal scroll. Desktop (1280px): left sidebar
