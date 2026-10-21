/**
 * GET  /api/content/drafts/[id]/source-check   the Sources panel: every legal
 *      claim with its verdict, source link and quoted passage (Task A7).
 * POST /api/content/drafts/[id]/source-check   check the claims that have no
 *      result for this version (each claim once per version).
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import { getCurrentUser } from "@/lib/supabase-route";
import { readContent } from "@/lib/draft-frame";
import { reviewAreaForDraft } from "@/lib/draft-frame-server";
import { getOperatingBrief } from "@/lib/social-operating-brief";
import { sentenceKey } from "@/lib/legal-learned";
import { decisionQuestion, readSourceCheck, sourceStanding, sourceStatus } from "@/lib/source-check";
import { loadSourceCheckInputs, runSourceCheck } from "@/lib/source-check-server";
import { recordAuditEvent } from "@/lib/content-findings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function load(id: string) {
  const { supabase, tenantId } = await getTenantClient();
  const { data: d } = await supabase
    .from("content_drafts")
    .select("id, title, topic, practice_area, metadata")
    .eq("id", id)
    .maybeSingle();
  return { d, tenantId };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { d, tenantId } = await load(id);
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const meta = (d.metadata as Record<string, unknown> | null) ?? {};
  const content = readContent(meta);
  if (!content) return NextResponse.json({ framed: false, claims: [], unchecked: [] });
  const [inputs, brief] = await Promise.all([loadSourceCheckInputs(tenantId), getOperatingBrief(tenantId)]);
  const st = sourceStatus(content, readSourceCheck(meta), inputs.thresholds, inputs.statutes, inputs.approved, sentenceKey);
  const area = reviewAreaForDraft({ title: d.title as string | null, topic: d.topic as string | null, practice_area: d.practice_area as string | null, metadata: meta });
  return NextResponse.json({
    framed: true,
    attorney: area ? brief.reviewersByPractice[area].name : null,
    checkedAt: readSourceCheck(meta)?.checked_at ?? null,
    claims: st.current.map((e) => ({
      ...e,
      standing: sourceStanding(e.source_url),
      question: e.verdict === "not_found" || e.verdict === "no_entry" ? decisionQuestion(e) : null,
    })),
    unchecked: st.unchecked,
  });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const { d, tenantId } = await load(id);
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const run = await runSourceCheck(tenantId, id);
    await recordAuditEvent({
      tenantId,
      draftId: id,
      event: "source_check",
      actorUserId: user.id,
      actorEmail: user.email,
      detail: { claims: run.claims, checked: run.checked, reused: run.reused },
    });
    return NextResponse.json({ claims: run.claims, checked: run.checked, reused: run.reused });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
