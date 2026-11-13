// .env.example must hold placeholders only. Fails if a value looks like a real secret.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fenced } from "../scripts/lib/md-fence";
import { findSecretLikeValues } from "../scripts/lib/secret-scan";

describe("eval report code fence", () => {
  it("uses a fence longer than any backtick run in the model output", () => {
    const [open, json, close] = fenced({ draftReply: "try ```code``` and `````five`````" });
    expect(open).toBe("``````json"); // 6 backticks: longest run inside is 5
    expect(close).toBe("``````");
    expect(json).toContain("```code```");
    expect(fenced({ a: 1 })[0]).toBe("```json");
  });
});

describe(".env.example", () => {
  it("contains no secret-like values", () => {
    expect(findSecretLikeValues(readFileSync(".env.example", "utf8"))).toEqual([]);
  });
});

describe("findSecretLikeValues", () => {
  // Synthetic values shaped like real ones. None of them is a real credential.
  const fake = {
    base64: "Zk3qP9x1LmVb7Ts2WcYh5NdR8aUe4GjXo0Iy6KtA+Bc=",
    anthropic: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    hex: "9f2c4e7a1b8d3f60a5c2e9d4b7f1038a6c5e2d9b",
  };

  it.each([
    ["random base64 under a key-like name", `LEAD_INTAKE_API_KEY=${fake.base64}`],
    ["random base64 under a neutral name", `SOMETHING=${fake.base64}`],
    ["an Anthropic key", `ANTHROPIC_API_KEY=${fake.anthropic}`],
    ["a hex token", `WEBHOOK_TOKEN=${fake.hex}`],
    ["a short real-looking value under a secret name", "NEXTAUTH_SECRET=hunter2hunter2"],
    ["a connection string with a real password", "DATABASE_URL=postgresql://app:Sup3rS3cretPw@host/db"],
  ])("flags %s", (_name, line) => {
    expect(findSecretLikeValues(line)).toHaveLength(1);
  });

  it.each([
    "LEAD_INTAKE_API_KEY=replace-with-a-random-secret",
    "ANTHROPIC_API_KEY=replace-with-your-anthropic-api-key",
    "ANTHROPIC_API_KEY=",
    "DATABASE_URL=postgresql://USER:PASSWORD@ep-example-123456-pooler.REGION.aws.neon.tech/neondb?sslmode=require",
    "SEED_DEMO_PASSWORD=DemoCRM-2026!",
    "AI_MODEL=claude-haiku-5-5",
    "# LEAD_INTAKE_API_KEY=anything-in-a-comment",
  ])("allows %s", (line) => {
    expect(findSecretLikeValues(line)).toEqual([]);
  });

  it("never includes the value in a finding", () => {
    const [f] = findSecretLikeValues(`LEAD_INTAKE_API_KEY=${fake.base64}`);
    expect(JSON.stringify(f)).not.toContain(fake.base64);
  });
});
