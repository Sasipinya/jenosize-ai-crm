"use client";
// Desktop navigation (md and up): fixed left sidebar with the current section highlighted.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive, NAV_ITEMS } from "./nav-items";

export function Sidebar({ footer }: { footer: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:flex md:w-60 md:flex-col md:border-r md:bg-background">
      <div className="flex h-16 items-center px-6 text-lg font-semibold">AI CRM</div>
      <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Main">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(pathname, href) ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
              isActive(pathname, href) && "bg-accent text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t p-3">{footer}</div>
    </aside>
  );
}
