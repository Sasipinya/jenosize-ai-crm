"use client";
// Retry for a LINE message that failed to send. Re-approves it and pushes again with the same retry key.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { callApi } from "@/lib/api-client";

export function RetryButton({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/messages/${messageId}/retry`, "POST", {});
    setBusy(false);
    if (!res.ok) setError(res.message);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={retry}>
        {busy ? "Retrying…" : "Retry"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
