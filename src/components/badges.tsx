// Small colored pills for lead stage and source, shared by list, detail and timeline.
import { cn } from "@/lib/utils";

const STAGE_STYLE: Record<string, string> = {
  new: "bg-sky-100 text-sky-800",
  qualified: "bg-indigo-100 text-indigo-800",
  proposal: "bg-amber-100 text-amber-900",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-rose-100 text-rose-800",
};

const pill = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

export const StageBadge = ({ stage }: { stage: string }) => (
  <span className={cn(pill, STAGE_STYLE[stage] ?? "bg-muted")}>{stage}</span>
);

export const SourceBadge = ({ source }: { source: string }) => (
  <span className={cn(pill, "border bg-background text-muted-foreground")}>{source}</span>
);
