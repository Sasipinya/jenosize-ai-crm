// pnpm line:simulate — sends a correctly signed LINE webhook payload to the LOCAL server.
// Usage: pnpm line:simulate [--type message|postback] [--user U123] [--text "..."] [--action book_call]
//        [--mid <message uuid>] [--event-id <id>] [--url http://localhost:3000]
// The secret is read from LINE_CHANNEL_SECRET (env or .env.local), never from a flag, and is never printed.
// Refuses any URL that is not localhost: this is a dev tool, not a way to post to a real deployment.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { signLineBody } from "../src/server/services/line/signature";
import { postbackData, QUICK_REPLY_ACTIONS, type QuickReplyAction } from "../src/server/services/line/notice";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: use the shell environment.
}

const { values } = parseArgs({
  options: {
    type: { type: "string", default: "message" },
    user: { type: "string", default: "Usimulated00000000000000000000001" },
    text: { type: "string", default: "สวัสดี สนใจบริการค่ะ" },
    action: { type: "string", default: "book_call" },
    mid: { type: "string", default: "" },
    "event-id": { type: "string", default: "" },
    url: { type: "string", default: "http://localhost:3000" },
  },
});

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const target = new URL("/api/webhooks/line", values.url);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) fail("Refusing: --url must be localhost.");
const secret = process.env.LINE_CHANNEL_SECRET;
if (!secret || secret.startsWith("replace-with-")) fail("Set LINE_CHANNEL_SECRET (the same value the local server uses).");

const base = {
  mode: "active",
  timestamp: Date.now(),
  source: { type: "user", userId: values.user },
  webhookEventId: values["event-id"] || randomUUID(),
  deliveryContext: { isRedelivery: false },
  replyToken: randomUUID().replaceAll("-", ""),
};
let event: Record<string, unknown>;
if (values.type === "message") {
  event = { ...base, type: "message", message: { id: String(Date.now()), type: "text", text: values.text } };
} else if (values.type === "postback") {
  if (!QUICK_REPLY_ACTIONS.includes(values.action as QuickReplyAction)) fail(`--action must be one of ${QUICK_REPLY_ACTIONS.join(", ")}`);
  const data = values.mid ? postbackData(values.action as QuickReplyAction, values.mid) : `action=${values.action}`;
  event = { ...base, type: "postback", postback: { data } };
} else {
  fail("--type must be message or postback");
}

const body = JSON.stringify({ destination: "Usimulated-destination", events: [event] });
const res = await fetch(target, {
  method: "POST",
  headers: { "content-type": "application/json", "x-line-signature": signLineBody(secret, body) },
  body,
});
console.log(`${res.status} ${await res.text()}`);
console.log(`event id: ${base.webhookEventId} (re-run with --event-id to test dedupe)`);
