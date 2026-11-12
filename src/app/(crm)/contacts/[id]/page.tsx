// Edit contact form, with a shortcut to start a lead for this contact.
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { contactFields } from "@/components/contact-fields";
import { EntityForm } from "@/components/entity-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { companyOptions } from "@/server/services/companies";
import { getContact } from "@/server/services/contacts";
import { salesUsers } from "@/server/services/leads";

export const metadata = { title: "Contact" };
export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const db = getDb();
  let contact;
  try {
    contact = await getContact(db, id.data);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const [companies, owners] = await Promise.all([companyOptions(db), salesUsers(db)]);

  return (
    <>
      <PageHeader
        title={contact.fullName}
        description={contact.erasedAt ? "Personal data erased (PDPA)" : "Edit contact"}
        actions={
          <Button asChild variant="outline">
            <Link href={`/leads/new?contactId=${contact.id}`}>New lead</Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <EntityForm
            fields={contactFields(companies, owners)}
            initial={{
              fullName: contact.fullName,
              email: contact.email,
              phone: contact.phone,
              companyId: contact.companyId,
              ownerId: contact.ownerId,
            }}
            endpoint={`/api/contacts/${contact.id}`}
            method="PATCH"
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </>
  );
}
