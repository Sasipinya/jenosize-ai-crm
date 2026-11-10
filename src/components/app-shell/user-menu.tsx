"use client";
// Shows who is signed in (name + role) and a logout button. Used in sidebar and mobile header.
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function UserMenu({ name, role, compact = false }: { name: string; role: string; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        {!compact && <p className="text-xs capitalize text-muted-foreground">{role}</p>}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="ออกจากระบบ"
        title="ออกจากระบบ"
        onClick={() => void signOut({ callbackUrl: "/login" })}
      >
        <LogOut />
      </Button>
    </div>
  );
}
