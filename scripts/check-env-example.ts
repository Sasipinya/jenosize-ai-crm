// pnpm check:env — fails (exit 1) if .env.example contains a value that looks like a real secret.
import { readFileSync } from "node:fs";
import { findSecretLikeValues } from "./lib/secret-scan";

const findings = findSecretLikeValues(readFileSync(".env.example", "utf8"));
if (findings.length) {
  for (const f of findings) console.error(`.env.example:${f.line} ${f.key}: ${f.reason}`); // never prints the value
  process.exit(1);
}
console.log(".env.example: no secret-like values");
