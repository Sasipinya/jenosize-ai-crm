// Field config for the company form, shared by the create and edit pages.
import type { FormField } from "@/components/entity-form";

export const COMPANY_FIELDS: FormField[] = [
  { name: "name", label: "Company name", required: true },
  { name: "industry", label: "Industry" },
  { name: "website", label: "Website", placeholder: "https://example.com" },
  { name: "size", label: "Size", placeholder: "e.g. 11-50" },
];
