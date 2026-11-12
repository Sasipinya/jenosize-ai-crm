"use client";
// One config-driven create/edit form used by companies, contacts and leads. Submits JSON to our API
// (server validates with Zod) and navigates on success. Field errors come back as one message.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, Textarea } from "@/components/ui/select";
import { callApi } from "@/lib/api-client";

export type FormField = {
  name: string;
  label: string;
  type?: "text" | "email" | "number" | "select" | "textarea";
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
};

export function EntityForm({
  fields,
  initial = {},
  endpoint,
  method,
  redirectTo,
  submitLabel,
}: {
  fields: FormField[];
  initial?: Record<string, string | null | undefined>;
  endpoint: string;
  method: "POST" | "PATCH";
  /** Where to go after success; `{id}` is replaced with the created/updated id. Omit to just refresh. */
  redirectTo?: string;
  submitLabel: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const body = Object.fromEntries(fields.map((f) => [f.name, String(form.get(f.name) ?? "")]));
    const res = await callApi<{ id: string }>(endpoint, method, body);
    setSaving(false);
    if (!res.ok) return setError(res.message);
    if (redirectTo) router.push(redirectTo.replace("{id}", res.data.id));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {fields.map((f) => {
        const id = `f-${f.name}`;
        const common = { id, name: f.name, required: f.required, defaultValue: initial[f.name] ?? "", placeholder: f.placeholder };
        return (
          <div key={f.name} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
            <Label htmlFor={id} className="mb-1.5 block">
              {f.label}
              {f.required && <span className="text-destructive"> *</span>}
            </Label>
            {f.type === "select" ? (
              <Select id={id} name={f.name} required={f.required} defaultValue={initial[f.name] ?? ""}>
                {!f.required && <option value="">—</option>}
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === "textarea" ? (
              <Textarea {...common} />
            ) : (
              <Input {...common} type={f.type ?? "text"} min={f.type === "number" ? 0 : undefined} />
            )}
          </div>
        );
      })}
      <div className="sm:col-span-2">
        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
