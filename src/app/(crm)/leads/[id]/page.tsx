// Lead detail: profile, company, contact, stage control, edit form, add-note and a unified timeline
// of activities + messages (newest first).
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SourceBadge, StageBadge } from "@/components/badges";
import { AiPanel, type PanelSuggestion } from "@/components/ai-panel";
import { EntityForm } from "@/components/entity-form";
import { LineComposer } from "@/components/line-composer";
import { RetryButton } from "@/components/retry-button";
import { NoteForm } from "@/components/note-form";
import { describeTimelineItem } from "@/lib/timeline";
import { PageHeader } from "@/components/page-header";
import { StageSelect } from "@/components/stage-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getLatestSuggestion } from "@/server/services/ai-suggestions";
import { companyOptions } from "@/server/services/companies";
import { getLeadDetail, salesUsers } from "@/server/services/leads";

export const metadata = { title: "Lead" };
export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const db = getDb();

  let detail;
  try {
    detail = await getLeadDetail(db, id.data);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const [companies, owners, latest] = await Promise.all([companyOptions(db), salesUsers(db), getLatestSuggestion(db, id.data)]);
  const panelSuggestion: PanelSuggestion | null = latest && {
    id: latest.id,
    status: latest.status,
    source: latest.source,
    model: latest.model,
    output: latest.originalOutput as PanelSuggestion["output"],
    finalOutput: latest.finalOutput as PanelSuggestion["finalOutput"],
    rejectReason: latest.rejectReason,
    rejectNote: latest.rejectNote,
  };
  const { lead, contact, company, ownerName, timeline } = detail;
  const canLine = Boolean(contact.lineUserId) && !contact.erasedAt;
  // Start the reply from the AI draft only after a person accepted it (accepted or edited).
  const acceptedDraft =
    latest && (latest.status === "accepted" || latest.status === "edited")
      ? ((latest.finalOutput as PanelSuggestion["finalOutput"])?.draftReply ?? "")
      : "";

  return (
    <>
      <PageHeader
        title={lead.title}
        description={`Created ${fmt(lead.createdAt)}`}
        actions={<StageSelect leadId={lead.id} stage={lead.stage} isAdmin={user.role === "admin"} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <StageBadge stage={lead.stage} />
                <SourceBadge source={lead.source} />
              </div>
              <Row label="Value">฿{lead.valueThb.toLocaleString("th-TH")}</Row>
              <Row label="Owner">{ownerName ?? "Unassigned"}</Row>
              <Row label="Score">{lead.score ?? "—"}</Row>
              {lead.lostReason && <Row label="Lost reason">{lead.lostReason}</Row>}
              <Row label="In stage since">{fmt(lead.stageChangedAt)}</Row>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
                {contact.fullName}
              </Link>
              <Row label="Email">{contact.erasedAt ? "Erased" : (contact.email ?? "—")}</Row>
              <Row label="Phone">{contact.erasedAt ? "Erased" : (contact.phone ?? "—")}</Row>
              <Row label="Company">
                {company ? (
                  <Link href={`/companies/${company.id}`} className="hover:underline">
                    {company.name}
                  </Link>
                ) : (
                  "—"
                )}
              </Row>
              {company && <Row label="Industry">{company.industry ?? "—"}</Row>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Edit lead</CardTitle>
            </CardHeader>
            <CardContent>
              <EntityForm
                fields={[
                  { name: "title", label: "Title", required: true },
                  { name: "valueThb", label: "Value (THB)", type: "number", required: true },
                  { name: "ownerId", label: "Owner", type: "select", options: owners.map((o) => ({ value: o.id, label: o.name })) },
                  { name: "companyId", label: "Company", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name })) },
                ]}
                initial={{ title: lead.title, valueThb: String(lead.valueThb), ownerId: lead.ownerId, companyId: lead.companyId }}
                endpoint={`/api/leads/${lead.id}`}
                method="PATCH"
                submitLabel="Save changes"
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI copilot</CardTitle>
          </CardHeader>
          <CardContent>
            <AiPanel key={panelSuggestion?.id ?? "none"} leadId={lead.id} suggestion={panelSuggestion} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {canLine && <LineComposer key={acceptedDraft} leadId={lead.id} initialText={acceptedDraft} />}
            <NoteForm leadId={lead.id} />
            <ol className="space-y-4 border-l pl-4">
              {timeline.map((item) => {
                const d = describeTimelineItem(item);
                return (
                  <li key={`${item.kind}-${item.id}`} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
                    <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{d.label}</span>
                      <span>{item.kind === "activity" ? (item.actorName ?? "System") : ""}</span>
                      <time dateTime={item.at.toISOString()}>{fmt(item.at)}</time>
                      {item.kind === "message" && item.direction === "out" && item.status === "failed" && <RetryButton messageId={item.id} />}
                    </div>
                    {d.text && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{d.text}</p>}
                  </li>
                );
              })}
              {timeline.length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
            </ol>
          </CardContent>
        </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right">{children}</span>
    </div>
  );
}
