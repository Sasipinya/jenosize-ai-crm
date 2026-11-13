// Detects values in an env template that look like real secrets. .env.example must hold
// placeholders only. Used by `pnpm lint` (scripts/check-env-example.ts) and tests/env-example.test.ts.

/** Keys whose value is public on purpose (see ADR 004). */
const ALLOWED_KEYS = new Set(["SEED_DEMO_PASSWORD"]);
const SECRET_KEY = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i;
const PLACEHOLDER = /^replace-with-[a-z0-9-]+$/;
const KNOWN_PREFIXES = /^(sk-[a-z]+-|sk_|ghp_|gho_|github_pat_|xox[abprs]-|AKIA[0-9A-Z]{12}|eyJ[A-Za-z0-9_-]{10,}\.)/;

function entropy(s: string): number {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

export type SecretFinding = { key: string; line: number; reason: string };

export function findSecretLikeValues(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq < 1) return;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!value || ALLOWED_KEYS.has(key)) return;
    const flag = (reason: string) => findings.push({ key, line: i + 1, reason });

    if (KNOWN_PREFIXES.test(value)) return flag("matches a known secret/token prefix");
    const url = value.match(/^[a-z]+:\/\/([^:/@\s]+):([^@\s]+)@/i);
    if (url && url[2] !== "PASSWORD" && !PLACEHOLDER.test(url[2]!)) return flag("connection string contains a real-looking password");
    if (SECRET_KEY.test(key) && !PLACEHOLDER.test(value)) return flag("secret-named key must be empty or start with replace-with-");
    if (!PLACEHOLDER.test(value) && value.length >= 20 && /^[A-Za-z0-9+/=_-]+$/.test(value) && entropy(value) > 3.5) {
      flag("long high-entropy value looks like a real secret");
    }
  });
  return findings;
}
