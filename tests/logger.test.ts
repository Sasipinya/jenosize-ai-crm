// Logger redaction: secrets and PII fields never reach log output.
import pino from "pino";
import { describe, expect, it } from "vitest";
import { REDACT_PATHS } from "@/server/logger";

describe("logger redaction", () => {
  it("censors password, token, email, phone, message body and auth headers", () => {
    const lines: string[] = [];
    const log = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, { write: (s: string) => lines.push(s) });
    log.info(
      {
        password: "p@ss",
        user: { email: "someone@example.com", phone: "000-111-2222" },
        message: { body: "ข้อความลูกค้า" },
        req: { headers: { authorization: "Bearer abc", "x-line-signature": "sig" } },
        leadId: "keep-me",
      },
      "event",
    );
    const out = lines.join("");
    for (const secret of ["p@ss", "someone@example.com", "000-111-2222", "ข้อความลูกค้า", "Bearer abc", '"sig"']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("keep-me");
  });
});
