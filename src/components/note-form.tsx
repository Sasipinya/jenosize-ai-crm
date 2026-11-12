"use client";
// Add a note or call log to a lead. Posts to the activities endpoint, then refreshes the timeline.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/select";
import { callApi } from "@/lib/api-client";

export function NoteForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [type, setType] = useState("note");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/leads/${leadId}/activities`, "POST", { type, text });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setText("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Textarea aria-label="Note text" placeholder="Write a note or call summary…" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Entry type" value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-32">
          <option value="note">Note</option>
          <option value="call">Call log</option>
        </Select>
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {busy ? "Saving…" : "Add"}
        </Button>
        {error && (
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
