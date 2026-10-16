/**
 * POST /api/content/drafts/[id]/keyword
 *   {}                    run keyword selection for this draft and store the decision
 *   { keyword: string }   make that the draft's primary keyword
 *
 * The draft-side "Choose keyword" (Oct 6 spec, Task 15). Drafts written before
 * the keyword guard carry a task title as their keyword and show "Keyword needs
 * selection"; until now only the brief wizard could pick a new one. This runs
 * the same pipeline (lib/keyword-selection-data.ts) and, on "use this", writes
 * the keyword everywhere primaryKeyword() and the analysis read it.
 * RLS-scoped client, so another tenant's draft is not found.
 */
import { NextRequest, NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/content-findings-store";
import { primaryKeyword } from "@/lib/draft-metadata";
import { keywordProblem } from "@/lib/keyword-guard";
import { selectKeyword } from "@/lib/keyword-selection-data";
import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Obj = Record<string, unknown>;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const input = (await req.json().catch(() => ({}))) as { keyword?: unknown };
  const { supabase, tenantId } = await getTenantClient();

  const { data: d } = await supabase
    .from("content_drafts")
    .select("id, title, topic, status, metadata, seo_brief")
    .eq("id", id)
    .maybeSingle();
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (d.status === "published" || d.status === "archived") {
    return NextResponse.json({ error: `A ${d.status} draft's keyword cannot be changed.` }, { status: 409 });
  }
  const meta = { ...((d.metadata as Obj | null) ?? {}) };
  const seo = { ...((d.seo_brief as Obj | null) ?? {}) };
  const current = primaryKeyword(d);

  // 1. Run the selection and keep the decision on the draft.
  if (typeof input.keyword !== "string") {
    let decision;
    try {
      decision = await selectKeyword({
        tenantId,
        title: (d.title as string) || (d.topic as string) || current,
        incoming: current || null,
        excludeDraftId: id,
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
    meta.keyword_selection = decision;
    const { error } = await supabase.from("content_drafts").update({ metadata: meta }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ decision });
  }

  // 2. Use a keyword.
  const keyword = input.keyword.trim().toLowerCase();
  const problem = keywordProblem(keyword);
  if (!keyword || problem) return NextResponse.json({ error: `Not a search keyword: ${problem ?? "empty"}.` }, { status: 400 });

  const km = { ...((meta.km_brief as Obj | null) ?? {}) };
  if (Object.keys(km).length) {
    km.primaryKeyword = keyword;
    meta.km_brief = km;
  }
  meta.primary_keyword = keyword;
  if ("keyword" in meta) meta.keyword = keyword;
  seo.primaryKeyword = keyword;
  // The analysis reads targetKeywords: the new keyword first, then any old
  // entries that are real keywords (a task title is dropped, not kept).
  const old = Array.isArray(seo.targetKeywords) ? (seo.targetKeywords as unknown[]) : [];
  seo.targetKeywords = [
    keyword,
    ...old.filter((k): k is string => typeof k === "string" && k.trim().toLowerCase() !== keyword && !keywordProblem(k)),
  ];

  const { error } = await supabase.from("content_drafts").update({ metadata: meta, seo_brief: seo }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recordAuditEvent({
    tenantId,
    draftId: id,
    event: "keyword_selected",
    actorUserId: user.id,
    actorEmail: user.email,
    detail: { from: current || null, to: keyword },
  });
  return NextResponse.json({ keyword });
}
