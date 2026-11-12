# ADR 007: Phase 2 CRM core decisions

## Context

Phase 2 needed choices the plan leaves open: who may see which leads, how terminal stages reopen, how the public form is protected, and how list search works for Thai.

## Decision

- **Visibility:** every logged-in user sees all leads, contacts and companies (20 users, one team). Owner is a filter, not a permission boundary.
- **Stage changes:** only `changeStage` changes a stage. It locks the row (`FOR UPDATE`), requires a reason for `lost`, and writes the `stage_change` activity in the same transaction. `won`/`lost` are terminal: only an admin may reopen, and reopening clears `lost_reason`. `PATCH /api/leads/:id` cannot touch stage.
- **Search:** `ILIKE '%q%'` with `%`, `_`, `\` escaped. It uses the existing `pg_trgm` GIN indexes and works for Thai, which has no word spaces. Lead search covers title, contact name and company name.
- **Website intake:** `POST /api/public/leads` needs `x-api-key` (constant-time compare), a per-IP rate limit (5/min) and a honeypot field (`companyWebsite`, dropped silently with a normal-looking success). The `/contact-us` page uses a server action that calls the same service, so the key never reaches the browser. Contact is reused by email; the message and company name go into the first activity. The company name is not auto-created, so public input cannot pollute the company list.
- **Rate limiter:** in-memory fixed window, per serverless instance. Not strict on Vercel (each instance has its own counter). Acceptable for 20 users; the API key is the main gate.
- **System activities:** the schema has no "created" activity type, so lead creation and edits are `note` rows with `payload.system = true`.
- **No new dependencies:** native `<select>`, GET forms and Next server components instead of a table or form library.

## Trade-off

Simple and testable, but the rate limit is soft and there is no per-owner permission model. Both are listed as known limitations for the README.
