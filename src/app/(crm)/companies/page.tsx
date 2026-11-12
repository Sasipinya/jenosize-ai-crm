// Companies list with name search and paging.
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import { Button } from "@/components/ui/button";
import { listQuerySchema } from "@/lib/validation/crm";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { listCompanies } from "@/server/services/companies";

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const raw = await searchParams;
  const parsed = listQuerySchema.safeParse({ q: [raw.q].flat()[0], page: [raw.page].flat()[0] });
  const query = parsed.success ? parsed.data : listQuerySchema.parse({});
  const result = await listCompanies(getDb(), query);

  return (
    <>
      <PageHeader
        title="Companies"
        actions={
          <Button asChild>
            <Link href="/companies/new">New company</Link>
          </Button>
        }
      />
      <SearchForm q={query.q} placeholder="ค้นหาชื่อบริษัท" />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Industry</th>
              <th className="px-4 py-3 font-medium">Size</th>
              <th className="px-4 py-3 font-medium">Website</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.items.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3">
                  <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{c.industry ?? "—"}</td>
                <td className="px-4 py-3">{c.size ?? "—"}</td>
                <td className="px-4 py-3 break-all">{c.website ?? "—"}</td>
              </tr>
            ))}
            {result.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  No companies match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination basePath="/companies" params={{ q: query.q }} page={result.page} pageSize={result.pageSize} total={result.total} />
    </>
  );
}
