// Sample public "Contact us" page (the website lead source). Public route (see proxy.ts).
// The server action calls the same service as POST /api/public/leads, with the same rate limit and
// honeypot, so the API key never reaches the browser.
import { headers } from "next/headers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/select";
import { websiteLeadSchema } from "@/lib/validation/crm";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { rateLimit } from "@/server/rate-limit";
import { safeErr } from "@/server/services/common";
import { createWebsiteLead } from "@/server/services/leads";
import { redirect } from "next/navigation";

export const metadata = { title: "Contact us" };

async function submit(formData: FormData) {
  "use server";
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`contact-us:${ip}`, 5, 60_000)) redirect("/contact-us?status=busy");
  const parsed = websiteLeadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/contact-us?status=invalid");
  try {
    await createWebsiteLead(getDb(), parsed.data);
  } catch (err) {
    logger.error({ event: "contact_us_failed", err: safeErr(err) });
    redirect("/contact-us?status=error");
  }
  redirect("/contact-us?status=thanks");
}

const MESSAGES: Record<string, { text: string; tone: string }> = {
  thanks: { text: "Thank you! We received your message and will get back to you soon.", tone: "text-emerald-700" },
  invalid: { text: "Please check the form: name, a valid email and a message are required.", tone: "text-destructive" },
  busy: { text: "Too many submissions. Please wait a minute and try again.", tone: "text-destructive" },
  error: { text: "Something went wrong. Please try again later.", tone: "text-destructive" },
};

export default async function ContactUsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const note = status ? MESSAGES[status] : undefined;
  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Contact us</CardTitle>
          <p className="text-sm text-muted-foreground">Tell us what you need and our sales team will reply.</p>
        </CardHeader>
        <CardContent>
          {note && (
            <p role="status" className={`mb-4 text-sm ${note.tone}`}>
              {note.text}
            </p>
          )}
          <form action={submit} className="space-y-4">
            <div>
              <Label htmlFor="fullName" className="mb-1.5 block">Full name *</Label>
              <Input id="fullName" name="fullName" required maxLength={200} />
            </div>
            <div>
              <Label htmlFor="email" className="mb-1.5 block">Email *</Label>
              <Input id="email" name="email" type="email" required maxLength={254} />
            </div>
            <div>
              <Label htmlFor="phone" className="mb-1.5 block">Phone</Label>
              <Input id="phone" name="phone" type="tel" maxLength={30} />
            </div>
            <div>
              <Label htmlFor="companyName" className="mb-1.5 block">Company</Label>
              <Input id="companyName" name="companyName" maxLength={200} />
            </div>
            <div>
              <Label htmlFor="message" className="mb-1.5 block">Message *</Label>
              <Textarea id="message" name="message" required maxLength={2000} />
            </div>
            {/* Honeypot: hidden from people and screen readers; bots that fill it are dropped. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="companyWebsite">Leave this empty</label>
              <input id="companyWebsite" name="companyWebsite" tabIndex={-1} autoComplete="off" />
            </div>
            <Button type="submit" className="w-full">Send message</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
