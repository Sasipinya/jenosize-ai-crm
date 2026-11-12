// Edit company form.
import { notFound } from "next/navigation";
import { z } from "zod";
import { COMPANY_FIELDS } from "@/components/company-fields";
import { EntityForm } from "@/components/entity-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getCompany } from "@/server/services/companies";

export const metadata = { title: "Company" };
export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  let company;
  try {
    company = await getCompany(getDb(), id.data);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  return (
    <>
      <PageHeader title={company.name} description="Edit company" />
      <Card>
        <CardContent className="pt-6">
          <EntityForm
            fields={COMPANY_FIELDS}
            initial={{ name: company.name, industry: company.industry, website: company.website, size: company.size }}
            endpoint={`/api/companies/${company.id}`}
            method="PATCH"
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </>
  );
}
