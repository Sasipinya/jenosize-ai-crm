// Authenticated app shell: sidebar on desktop (md+), top bar + bottom tab nav on mobile.
// Re-checks the session server-side (the proxy is not the only guard).
import { BottomNav } from "@/components/app-shell/bottom-nav";
import { Sidebar } from "@/components/app-shell/sidebar";
import { UserMenu } from "@/components/app-shell/user-menu";
import { requireUser } from "@/server/auth";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const menu = <UserMenu name={user.name} role={user.role} />;

  return (
    <div className="min-h-dvh bg-muted/40">
      <Sidebar footer={menu} />
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-background px-4 md:hidden">
        <span className="font-semibold">AI CRM</span>
        <div className="max-w-[60%]">
          <UserMenu name={user.name} role={user.role} compact />
        </div>
      </header>
      <div className="md:pl-60">
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 md:px-8 md:py-8">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
