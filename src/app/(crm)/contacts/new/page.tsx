// Create contact form (company picked from a dropdown).
import { EntityForm } from "@/components/entity-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { contactFields } from "@/components/contact-fields";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { companyOptions } from "@/server/services/companies";
import { salesUsers } from "@/server/services/leads";

export const metadata = { title: "New contact" };
export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  const user = await requireUser();
  const db = getDb();
  const [companies, owners] = await Promise.all([companyOptions(db), salesUsers(db)]);
  return (
    <>
      <PageHeader title="New contact" />
      <Card>
        <CardContent className="pt-6">
          <EntityForm
            fields={contactFields(companies, owners)}
            initial={{ ownerId: user.id }}
            endpoint="/api/contacts"
            method="POST"
            redirectTo="/contacts/{id}"
            submitLabel="Create contact"
          />
        </CardContent>
      </Card>
    </>
  );
}
