# PDPA: the LINE privacy notice

This describes what the system does. It is not legal advice.

## What happens

The first message from a new LINE user gets one automatic reply: a fixed privacy notice
(`src/server/services/line/notice.ts`). When LINE accepts it, the system sets `contacts.consent_at` and writes one
`consent` activity (`basis: "notice"`, `noticeVersion`, the exact text). The notice is **not** a row in `messages`;
the activity is its audit record.

If LINE rejects the notice, `consent_at` stays empty and the next message from that user tries again. So
"consent recorded" always means "the user was told".

## Why this one automatic reply is allowed

The rule is: AI output never sends a LINE message, and every outbound message is approved by a person. The notice is
the only exception, and it differs in the ways that matter:

- It is **not AI output.** It is a fixed template with one variable (`APP_URL`). No model, no customer text in it.
- It is a **disclosure we owe at the moment we first collect personal data**, not a sales message. Waiting for a
  salesperson would leave the user's data collected, with no notice, for hours.
- It is **sent once per user** (deterministic retry key, `consent_at` guard) and has no Quick Reply buttons.
- It **adds no new data**: it states what is already being done with the message.

Any other automatic message is out of scope and must not be added without changing this rule.

## Known limitation

This is a **notice-based** approach, not **explicit opt-in consent**. The user is informed and keeps chatting; they
never tick or tap "I agree". `consent_at` therefore means "notice delivered", not "user agreed". If the business
needs explicit consent (for example for marketing messages), add an opt-in step (a Quick Reply or a form) and a
separate timestamp. Whether the notice-based approach is enough for a given use is a legal question for the owner.

The notice promises deletion on request in chat. **The erase action is not built:** `contacts.erased_at` and the `data_erased`
activity type exist, and edits and sends to an erased contact are blocked, but nothing sets them, so deletion is a manual
process by a staff member. The `/privacy` page the notice links to exists (Thai + English, `src/app/privacy/page.tsx`). It
states the retention policy (below). The activity log is append-only, so free text in notes stays after a
contact is anonymised; the page says so. See "Production next steps" in the README.
