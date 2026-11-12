// Leads list: search (Thai-friendly), filters (stage/source/owner), paging, inline stage change.
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import { SourceBadge } from "@/components/badges";
import { StageSelect } from "@/components/stage-select";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { leadListQuerySchema } from "@/lib/validation/crm";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { LEAD_SOURCES, LEAD_STAGES } from "@/server/db/schema";
import { listLeads, salesUsers } from "@/server/services/leads";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** Empty or malformed filter values fall back to "no filter" instead of erroring the page. */
function parseQuery(raw: Record<string, string | string[] | undefined>) {
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = leadListQuerySchema.safeParse(Object.fromEntries(Object.entries(flat).filter(([, v]) => v)));
  return parsed.success ? parsed.data : leadListQuerySchema.parse({});
}

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const query = parseQuery(await searchParams);
  const db = getDb();
  const [result, owners] = await Promise.all([listLeads(db, query), salesUsers(db)]);
  const isAdmin = user.role === "admin";

  return (
    <>
      <PageHeader
        title="Leads"
        description="Search by lead, contact or company name"
        actions={
          <Button asChild>
            <Link href="/leads/new">New lead</Link>
          </Button>
        }
      />
      <SearchForm q={query.q} placeholder="ค้นหาชื่อ lead, ผู้ติดต่อ, บริษัท">
        <Select name="stage" defaultValue={query.stage ?? ""} aria-label="Stage" className="w-auto">
          <option value="">All stages</option>
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select name="source" defaultValue={query.source ?? ""} aria-label="Source" className="w-auto">
          <option value="">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select name="owner" defaultValue={query.owner ?? ""} aria-label="Owner" className="w-auto max-w-40">
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </SearchForm>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Lead</th>
              <th className="px-4 py-3 font-medium">Contact / company</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 text-right font-medium">Value (฿)</th>
              <th className="px-4 py-3 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.items.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="px-4 py-3">
                  <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                    {l.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div>{l.contactName}</div>
                  <div className="text-xs text-muted-foreground">{l.companyName ?? "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <StageSelect leadId={l.id} stage={l.stage} isAdmin={isAdmin} />
                </td>
                <td className="px-4 py-3">
                  <SourceBadge source={l.source} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{l.valueThb.toLocaleString("th-TH")}</td>
                <td className="px-4 py-3">{l.ownerName ?? <span className="text-muted-foreground">Unassigned</span>}</td>
              </tr>
            ))}
            {result.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No leads match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        basePath="/leads"
        params={{ q: query.q, stage: query.stage, source: query.source, owner: query.owner }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </>
  );
}
