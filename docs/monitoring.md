# Monitoring

Status: **logging is in place; alerting is not.** Nothing here pages anyone. The app writes structured logs to stdout (Vercel Logs in production); the alert rules below say what to watch once someone connects a log drain or reads the logs by hand.

## Logging

- **Library:** pino, one JSON object per line, `service: "ai-crm"` (`src/server/logger.ts`). Level from `LOG_LEVEL`, default `info` in production and `debug` otherwise.
- **requestId:** every API route generates a UUID per request (`src/server/http.ts`; the LINE webhook and public lead routes generate their own). It is logged on `api_request` and returned in every JSON response body (`requestId`), so a user's error report can be matched to a log line. Page renders (server components) have no requestId.
- **Redaction:** `REDACT_PATHS` in `src/server/logger.ts` replaces with `[REDACTED]` any field named `password`, `passwordHash`, `token`, `accessToken`, `apiKey`, `secret`, `channelSecret`, `email`, `phone`, `body`, `displayName`, `raw` (top level and one level deep) and the headers `authorization`, `cookie`, `x-line-signature`, `x-api-key`. Message text, names and contact details must therefore go in fields with those names, or not be logged at all. Redaction is by field name and by depth: a secret in a differently named field, or nested two levels deep, is **not** caught (see `tests/logger.test.ts`).
- **Errors:** unexpected errors are logged as `unhandled_error` with the error name and Postgres code only, never the message text (it can contain customer data). Clients get `{ error: { code, message } }` without a stack trace.

### Events worth knowing

| `event` | Where | Fields that matter |
| --- | --- | --- |
| `api_request` | every `withAuth` route | `requestId`, `userId`, `method`, `status`, `durationMs` |
| `unhandled_error` | `src/server/http.ts` | `requestId`, error name, pg code |
| `ai_suggest` | `ai-suggestions.ts` | `cached`, `adapter`, `model`, `source` (`llm`/`fallback`), `attempts`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `estimatedCostUsd`, `durationMs` |
| `line_webhook` | webhook route | events received |
| `line_bad_signature` | webhook | a request with a wrong or missing signature was refused |
| `line_event_failed` | webhook | processing of a stored event threw (also written to `line_events.error`) |
| `line_push`, `line_deliver_error` | outbound | push result, attempts; delivery error |
| `line_notice_failed`, `line_notice_error` | inbound | privacy notice not accepted by LINE (next message retries it) |
| `line_postback_ignored` | inbound | postback ignored (reason) |
| `line_default_owner_not_found` | inbound | `LINE_DEFAULT_OWNER_EMAIL` does not match a user |
| `public_lead`, `contact_us_failed` | website intake | lead created / form error |

## What to alert on

Thresholds are starting points for a 20-user team, not measured values.

| Signal | How to see it | Why it matters | Starting threshold |
| --- | --- | --- | --- |
| AI fallback rate | `ai_suggest` with `source = "fallback"` ÷ non-cached `ai_suggest` | The model is failing, timing out, being rate limited, or the guardrails reject most output (the badge says "AI unavailable" even for a guardrail fallback) | > 20% over 1 h |
| AI latency | `ai_suggest.durationMs`, p95 | A call is cut at 15 s with 1 retry, so p95 near 15 s means timeouts | p95 > 10 s |
| AI cost | sum of `estimatedCostUsd` per day | Spend is capped in the Anthropic console too, but this shows the trend | above the daily budget you set |
| Webhook 401 | `line_bad_signature` | A wrong channel secret after a rotation, or someone probing the endpoint | any burst; a sustained run means the secret is wrong |
| Webhook / event failures | `line_event_failed`, 5xx on `/api/webhooks/line`, rows in `line_events` with `error` set and `processed_at` null | Customer messages are stored but not turned into contacts/messages | any |
| Failed outbound messages | `messages.status = 'failed'`, `line_deliver_error` | A salesperson's reply never reached the customer; the Retry button is the only recovery | any older than 15 min |
| Messages stuck in `approved` | `messages.status = 'approved'` older than a minute | A send was interrupted | any |
| Privacy notice failures | `line_notice_failed` | A new user was not told how their data is used (`consent_at` stays empty) | any |
| API errors | `api_request` with `status >= 500`, `unhandled_error` | Bugs or DB trouble | > 1% of requests |
| DB connectivity | Neon dashboard, 5xx spike | Everything depends on it | provider alerts |

Not available yet: there is no `/api/health` endpoint for an uptime check (the route guard already lists it as public, but no route exists), and no dashboard.

## Operating notes

- To follow one user report: ask for the `requestId` from the error response, then search the logs for it.
- Do not add message bodies, names, emails or phone numbers to log fields. If a new field might carry them, add its name to `REDACT_PATHS` and a case to `tests/logger.test.ts`.
