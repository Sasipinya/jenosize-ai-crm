"use client";
// Stage dropdown. Choosing "lost" asks for a reason first (the API and DB both require one).
// Terminal stages (won/lost) are locked for non-admins, matching the server rule.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { callApi } from "@/lib/api-client";
import type { LeadStage } from "@/server/db/schema";

// Local list keeps drizzle out of the client bundle; `satisfies` keeps it in sync with the schema type.
const STAGES = ["new", "qualified", "proposal", "won", "lost"] as const satisfies readonly LeadStage[];

export function StageSelect({ leadId, stage, isAdmin }: { leadId: string; stage: string; isAdmin: boolean }) {
  const router = useRouter();
  const [pendingLost, setPendingLost] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = (stage === "won" || stage === "lost") && !isAdmin;

  async function submit(next: string, lostReason?: string) {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/leads/${leadId}/stage`, "POST", { stage: next, lostReason });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setPendingLost(false);
    setReason("");
    router.refresh();
  }

  return (
    <div className="min-w-0">
      <Select
        aria-label="Change stage"
        value={stage}
        disabled={locked || busy}
        title={locked ? "Only an admin can reopen a won or lost lead" : undefined}
        className="h-9 w-32"
        onChange={(e) => {
          if (e.target.value === "lost") setPendingLost(true);
          else void submit(e.target.value);
        }}
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      {pendingLost && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Input aria-label="Lost reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 w-48" />
          <Button size="sm" disabled={busy || !reason.trim()} onClick={() => void submit("lost", reason)}>
            Mark lost
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPendingLost(false)}>
            Cancel
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
