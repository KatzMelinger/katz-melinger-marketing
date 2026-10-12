/**
 * GET /api/content/drafts/[id]/correction-report
 *
 * The draft's correction report as a Word document (Oct 6 spec, Task 23):
 * every live change in "Changes made" and every open decision. Stale
 * findings are closed first, so the report never lists a sentence that is no
 * longer in the draft.
 */
import { NextRequest, NextResponse } from "next/server";

import { getTenantClient } from "@/lib/tenant-db";
import { closeStaleFindings } from "@/lib/content-findings-store";
import { readFixLog } from "@/lib/legal-fix-log";
import { buildCorrectionReport } from "@/lib/correction-report-docx";
import { reviewerFor } from "@/lib/legal-reviewers";
import { CAPPED_ENGINES } from "@/lib/finding-severity";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenantId } = await getTenantClient();
  const { data: d, error } = await supabase
    .from("content_drafts")
    .select("id, title, topic, status, body, practice_area, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { open } = await closeStaleFindings({ draftId: id, tenantId, body: typeof d.body === "string" ? d.body : "" });
  // Decisions are the review items, not style suggestions (Task 25).
  const decisions = open.filter((f) => !CAPPED_ENGINES.has(f.source) && f.severity !== "advisory");
  const log = readFixLog((d.metadata as Record<string, unknown> | null) ?? {});
  const title = (d.title as string | null)?.trim() || (d.topic as string | null)?.trim() || "Untitled";
  const buffer = await buildCorrectionReport({
    title,
    status: d.status as string,
    reviewer:
      reviewerFor({
        practiceArea: d.practice_area as string | null,
        topic: d.topic as string | null,
        title: d.title as string | null,
      })?.name ?? null,
    changes: log.changes,
    decisions,
    reviewedAt: log.reviewed_at ?? null,
    generatedAt: new Date().toISOString(),
  });
  const filename = `Correction report - ${title.replace(/[^\w\s-]/g, "").slice(0, 60).trim()}.docx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
