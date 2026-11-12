// Plain GET search/filter form (works without JS, keeps state in the URL). Children = extra filters.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SearchForm({ q, placeholder, children }: { q: string; placeholder: string; children?: React.ReactNode }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
      <Input name="q" defaultValue={q} placeholder={placeholder} aria-label="Search" className="min-w-0 flex-1 basis-56" />
      {children}
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}
