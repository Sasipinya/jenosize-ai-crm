// Create company form.
import { COMPANY_FIELDS } from "@/components/company-fields";
import { EntityForm } from "@/components/entity-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/server/auth";

export const metadata = { title: "New company" };

export default async function NewCompanyPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="New company" />
      <Card>
        <CardContent className="pt-6">
          <EntityForm fields={COMPANY_FIELDS} endpoint="/api/companies" method="POST" redirectTo="/companies/{id}" submitLabel="Create company" />
        </CardContent>
      </Card>
    </>
  );
}
