// Structured JSON logger (pino). Redacts secrets and PII by path; never log message bodies raw.
// Full request logging (requestId per request) is wired in Phase 5 (R25).
import pino from "pino";

export const REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "apiKey",
  "*.apiKey",
  "secret",
  "*.secret",
  "email",
  "*.email",
  "phone",
  "*.phone",
  "body",
  "*.body",
  "channelSecret",
  "*.channelSecret",
  "displayName",
  "*.displayName",
  "raw",
  "*.raw",
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-line-signature"]',
  'req.headers["x-api-key"]',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: { service: "ai-crm" },
});
