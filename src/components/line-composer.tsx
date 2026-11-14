"use client";
// Compose and send a LINE message from the lead page. Clicking "Approve & send" is the human approval:
// the text can be typed or start from an AI draft the salesperson already accepted. Nothing is sent otherwise.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/select";
import { callApi } from "@/lib/api-client";

export function LineComposer({ leadId, initialText }: { leadId: string; initialText: string }) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await callApi<{ status: string }>("/api/messages", "POST", { leadId, body: text });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    if (res.data.status === "sent") setText("");
    else setError("LINE did not accept the message. It is saved as failed in the timeline: use Retry there.");
    if (res.data.status === "sent") setNotice("Sent on LINE.");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label htmlFor="line-message" className="text-xs text-muted-foreground">
        Reply on LINE (sent only when you click Approve &amp; send)
      </label>
      <Textarea id="line-message" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={3} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {busy ? "Sending…" : "Approve & send"}
        </Button>
        {notice && <span className="text-sm text-muted-foreground">{notice}</span>}
        {error && (
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
