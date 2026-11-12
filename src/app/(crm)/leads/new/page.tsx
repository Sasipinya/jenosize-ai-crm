// Manual lead form. The contact is picked from a name search (2,000 contacts is too many for one
// dropdown); the search is a plain GET so it needs no client JS.
import Link from "next/link";
import { EntityForm, type FormField } from "@/components/entity-form";
import { PageHeader } from "@/components/page-header";
import { SearchForm } from "@/components/search-form";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { companyOptions } from "@/server/services/companies";
import { getContactOption, searchContacts } from "@/server/services/contacts";
import { z } from "zod";
import { salesUsers } from "@/server/services/leads";

export const metadata = { title: "New lead" };
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = first(sp.q).trim().slice(0, 100);
  const preselected = first(sp.contactId);
  const db = getDb();
  const [found, companies, owners, picked] = await Promise.all([
    searchContacts(db, q),
    companyOptions(db),
    salesUsers(db),
    z.uuid().safeParse(preselected).success ? getContactOption(db, preselected) : Promise.resolve(null),
  ]);
  // Keep the preselected contact (from "New lead" on a contact page) in the list even if the search misses it.
  const contacts = picked && !found.some((c) => c.id === picked.id) ? [picked, ...found] : found;

  const fields: FormField[] = [
    { name: "title", label: "Lead title", required: true, placeholder: "e.g. CRM for retail shop" },
    {
      name: "contactId",
      label: "Contact",
      type: "select",
      required: true,
      options: contacts.map((c) => ({ value: c.id, label: `${c.fullName}${c.companyName ? ` · ${c.companyName}` : ""}` })),
    },
    { name: "valueThb", label: "Value (THB)", type: "number" },
    { name: "ownerId", label: "Owner", type: "select", options: owners.map((o) => ({ value: o.id, label: o.name })) },
    { name: "companyId", label: "Company (defaults to the contact's)", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name })) },
  ];

  return (
    <>
      <PageHeader title="New lead" description="Create a lead manually" />
      <Card className="mb-4">
        <CardContent className="pt-6">
          <p className="mb-2 text-sm font-medium">1. Find the contact</p>
          <SearchForm q={q} placeholder="ค้นหาชื่อผู้ติดต่อ" />
          <p className="text-xs text-muted-foreground">
            Showing up to 10 matches. Not there? <Link href="/contacts/new" className="underline">Create a contact</Link> first.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="mb-4 text-sm font-medium">2. Lead details</p>
          <EntityForm
            fields={fields}
            initial={{ contactId: preselected, ownerId: user.id }}
            endpoint="/api/leads"
            method="POST"
            redirectTo="/leads/{id}"
            submitLabel="Create lead"
          />
        </CardContent>
      </Card>
    </>
  );
}
