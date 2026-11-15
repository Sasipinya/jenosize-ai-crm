"use client";
// AI copilot panel on the lead page. Shows the latest suggestion; Accept / Edit / Dismiss are the
// only actions that change data. A "Rule-based fallback" badge is always visible for fallback output.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/select";
import { callApi } from "@/lib/api-client";
import { dueLabel, isThaiText } from "@/lib/due-label";
import type { SuggestionOutput } from "../../skills/crm-copilot/schema";

export type PanelSuggestion = {
  id: string;
  status: "pending" | "accepted" | "edited" | "dismissed";
  source: "llm" | "fallback";
  model: string | null;
  output: SuggestionOutput;
  finalOutput: SuggestionOutput | null;
  rejectReason: string | null;
  rejectNote: string | null;
  /** Quick-reply points the customer earned; Accept adds them on top of the AI score. */
  boostTotal: number;
};

const REJECT_OPTIONS = [
  { value: "wrong_facts", label: "Wrong facts" },
  { value: "wrong_tone", label: "Wrong tone" },
  { value: "missing_info", label: "Missing info" },
  { value: "wrong_action", label: "Wrong action" },
] as const;

const ACTION_LABEL: Record<string, string> = {
  call: "Call",
  line_reply: "Reply on LINE",
  send_proposal: "Send proposal",
  wait: "Wait",
  close_lost: "Close as lost",
};

export function AiPanel({ leadId, suggestion, tapNote = null }: { leadId: string; suggestion: PanelSuggestion | null; tapNote?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState(suggestion?.output.draftReply ?? "");
  const [note, setNote] = useState("");

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setError(r.message ?? "Something went wrong");
    if (done) setNotice(done);
    router.refresh();
  }

  const generate = () =>
    run(async () => {
      const res = await callApi<{ cached: boolean }>("/api/ai/suggest", "POST", { leadId });
      if (res.ok && res.data.cached) setNotice("No new activity since the last suggestion.");
      return res.ok ? { ok: true } : { ok: false, message: res.message };
    });

  const decide = (body: unknown, done: string) =>
    run(async () => {
      const res = await callApi(`/api/ai/suggestions/${suggestion!.id}/decision`, "POST", body);
      return res.ok ? { ok: true } : { ok: false, message: res.message };
    }, done);

  const pending = suggestion?.status === "pending";
  const shown = suggestion ? (suggestion.finalOutput ?? suggestion.output) : null;
  const edited = pending && suggestion && draft.trim() !== (suggestion.output.draftReply ?? "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={suggestion ? "outline" : "default"} onClick={generate} disabled={busy}>
          {busy ? "Working…" : suggestion ? "Refresh suggestion" : "Get AI suggestion"}
        </Button>
        {suggestion?.source === "fallback" && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Rule-based fallback (AI unavailable)</span>
        )}
        {suggestion?.source === "llm" && <span className="text-xs text-muted-foreground">AI · {suggestion.model}</span>}
        {suggestion && !pending && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium capitalize">{suggestion.status}</span>
        )}
      </div>

      {tapNote && (
        <p role="note" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          {tapNote}
        </p>
      )}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {shown && suggestion && (
        <div className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap break-words">{shown.summary}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <span className="text-muted-foreground">Score </span>
              <strong>{shown.score}</strong>
            </span>
            <span>
              <span className="text-muted-foreground">Confidence </span>
              {shown.confidence}
            </span>
            <span>
              <span className="text-muted-foreground">Next </span>
              {ACTION_LABEL[shown.nextBestAction.type]} · {dueLabel(shown.nextBestAction.dueInDays, isThaiText(shown.draftReply))}
            </span>
          </div>
          <ul className="list-disc space-y-0.5 pl-5">
            {shown.scoreReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">{shown.nextBestAction.detail}</p>
          {shown.missingInfo.length > 0 && (
            <p>
              <span className="text-muted-foreground">Missing: </span>
              {shown.missingInfo.join(", ")}
            </p>
          )}

          {pending ? (
            <>
              {suggestion.output.draftReply !== null && (
                <div className="space-y-1">
                  <label htmlFor="ai-draft" className="text-xs text-muted-foreground">
                    Draft reply (editable, not sent anywhere)
                  </label>
                  <Textarea id="ai-draft" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} rows={4} />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {edited ? (
                  <Button
                    size="sm"
                    disabled={busy || !draft.trim()}
                    onClick={() => decide({ action: "edit", finalOutput: { ...suggestion.output, draftReply: draft.trim() } }, "Saved with your edits.")}
                  >
                    Accept with edits
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => decide({ action: "accept" }, "Accepted.")}>
                    {suggestion.boostTotal !== 0
                      ? `Accept: AI ${suggestion.output.score} ${suggestion.boostTotal > 0 ? "+" : "−"} quick replies ${Math.abs(suggestion.boostTotal)} = ${Math.max(0, Math.min(100, suggestion.output.score + suggestion.boostTotal))}`
                      : "Accept"}
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Dismiss: pick a reason (one click)</p>
                <div className="flex flex-wrap items-center gap-2">
                  {REJECT_OPTIONS.map((o) => (
                    <Button
                      key={o.value}
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => decide({ action: "dismiss", rejectReason: o.value, rejectNote: note }, "Dismissed.")}
                    >
                      {o.label}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide({ action: "dismiss", rejectNote: note }, "Dismissed.")}>
                    No reason
                  </Button>
                </div>
                <Input aria-label="Note (optional)" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </div>
              <p className="text-xs text-muted-foreground">Accepting sets the lead score and logs an activity. Nothing is sent to the customer.</p>
            </>
          ) : (
            <>
              {shown.draftReply && <p className="whitespace-pre-wrap break-words rounded border p-2">{shown.draftReply}</p>}
              {(suggestion.rejectReason || suggestion.rejectNote) && (
                <p className="text-muted-foreground">
                  Dismissed{suggestion.rejectReason ? `: ${suggestion.rejectReason.replace("_", " ")}` : ""}
                  {suggestion.rejectNote ? ` · ${suggestion.rejectNote}` : ""}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
