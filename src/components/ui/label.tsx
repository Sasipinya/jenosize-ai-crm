import type * as React from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui Label (plain <label>; no Radix needed for our use). */
export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}
