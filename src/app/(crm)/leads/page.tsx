// Phase 1 placeholder: proves auth + DB on a deployed build by showing live counts. Real list is Phase 2.
import { count } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { companies, contacts, leads } from "@/server/db/schema";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const user = await requireUser();
  const db = getDb();
  const [[l], [c], [co]] = await Promise.all([
    db.select({ n: count() }).from(leads),
    db.select({ n: count() }).from(contacts),
    db.select({ n: count() }).from(companies),
  ]);
  const stats = [
    { label: "Leads", value: l?.n ?? 0 },
    { label: "Contacts", value: c?.n ?? 0 },
    { label: "Companies", value: co?.n ?? 0 },
  ];

  return (
    <>
      <PageHeader title="Leads" description={`สวัสดี คุณ${user.name}`} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{s.value.toLocaleString("th-TH")}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">Lead list, filters and search arrive in Phase 2.</p>
    </>
  );
}
