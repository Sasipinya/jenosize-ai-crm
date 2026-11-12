// Contacts list with name/email search and paging. Erased contacts show a placeholder, never PII.
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import { Button } from "@/components/ui/button";
import { listQuerySchema } from "@/lib/validation/crm";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { listContacts } from "@/server/services/contacts";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const raw = await searchParams;
  const parsed = listQuerySchema.safeParse({ q: [raw.q].flat()[0], page: [raw.page].flat()[0] });
  const query = parsed.success ? parsed.data : listQuerySchema.parse({});
  const result = await listContacts(getDb(), query);

  return (
    <>
      <PageHeader
        title="Contacts"
        actions={
          <Button asChild>
            <Link href="/contacts/new">New contact</Link>
          </Button>
        }
      />
      <SearchForm q={query.q} placeholder="ค้นหาชื่อหรืออีเมล" />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Phone</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.items.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3">
                  <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                    {c.fullName}
                  </Link>
                </td>
                <td className="px-4 py-3">{c.companyName ?? "—"}</td>
                <td className="px-4 py-3 break-all">{c.erasedAt ? "Erased" : (c.email ?? "—")}</td>
                <td className="px-4 py-3">{c.erasedAt ? "Erased" : (c.phone ?? "—")}</td>
              </tr>
            ))}
            {result.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  No contacts match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination basePath="/contacts" params={{ q: query.q }} page={result.page} pageSize={result.pageSize} total={result.total} />
    </>
  );
}
