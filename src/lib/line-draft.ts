// Which text the "Reply on LINE" box starts with. An accepted AI draft is offered only until a LINE message has
// been created for the lead at or after that acceptance (any status, including failed): after that it was used.
// A message with exactly the acceptance timestamp counts as used: when unsure, do not offer the draft again.
type Suggestion = { status: string; finalDraft: string | null; decidedAt: Date | null };
type Item = { kind: string; at: Date; direction?: string };

export function acceptedDraftFor(latest: Suggestion | null, timeline: Item[]): string {
  if (!latest || (latest.status !== "accepted" && latest.status !== "edited") || !latest.decidedAt) return "";
  const decidedAt = latest.decidedAt;
  const usedAlready = timeline.some((i) => i.kind === "message" && i.direction === "out" && i.at.getTime() >= decidedAt.getTime());
  return usedAlready ? "" : (latest.finalDraft ?? "");
}
