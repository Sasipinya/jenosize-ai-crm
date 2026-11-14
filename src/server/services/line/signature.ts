// LINE webhook signature: base64(HMAC-SHA256(channel secret, raw body)), compared in constant time.
// Pure and dependency-free so the webhook route, the tests and scripts/simulate-line-webhook.ts share it.
import { createHmac, timingSafeEqual } from "node:crypto";

export function signLineBody(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

/** False when the secret or header is missing, so an unconfigured server rejects everything (fail closed). */
export function verifyLineSignature(secret: string | undefined, rawBody: string, header: string | null): boolean {
  // Fail closed on a missing secret or the public .env.example placeholder (anyone could sign with that one).
  if (!secret || secret.startsWith("replace-with-") || !header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(signLineBody(secret, rawBody));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
