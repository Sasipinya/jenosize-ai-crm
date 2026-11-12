// Field config for the contact form, shared by the create and edit pages.
import type { FormField } from "@/components/entity-form";

type Option = { id: string; name: string };

export const contactFields = (companies: Option[], owners: Option[]): FormField[] => [
  { name: "fullName", label: "Full name", required: true },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone" },
  { name: "companyId", label: "Company", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name })) },
  { name: "ownerId", label: "Owner", type: "select", options: owners.map((o) => ({ value: o.id, label: o.name })) },
];
