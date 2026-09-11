/**
 * GET  /api/content/drafts/[id]/cannibalization  — run the check, report
 * POST /api/content/drafts/[id]/cannibalization  — resolve one conflict
 *        body: { url, keyword }
 *
 * Item 17's second half. The gate in app/api/agent/approve holds the draft;
 * this is how a reviewer clears it without hand-editing.
 *
 * Resolving means what Diana specified: link the commercial term to the page
 * that owns it. The blog yields the query and hands its authority to the
 * service page, which is why the ANCHOR is the keyword itself rather than a
 * generic "learn more" — the anchor is the half that passes the signal on.
 *
 * Repositioning to informational intent is left to the writer, deliberately.
 * Rewriting someone's angle is a content decision, and a button that silently
 * did it would produce drafts nobody recognises. The finding says what to do;
 * the link is the mechanical part worth automating.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  checkBlogCannibalization,
  conflictAnchor,
  linkFirstMention,
} from "@/lib/blog-cannibalization";
import { syncFindings } from "@/lib/content-findings-store";
import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadDraft(supabase: any, id: string) {
  const { data } = await supabase
    .from("content_drafts")
    .select("id, body, title, topic, seo_brief")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

function keywordsOf(draft: any): string[] {
  const brief = (draft?.seo_brief ?? null) as { targetKeywords?: unknown } | null;
  return Array.isArray(brief?.targetKeywords)
    ? (brief.targetKeywords as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;

  const { supabase, tenantId } = await getTenantClient();
  const draft = await loadDraft(supabase, id);
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await checkBlogCannibalization({
    targetKeywords: keywordsOf(draft),
    title: (draft.title as string | null) ?? (draft.topic as string | null) ?? null,
  });

  // Persist so the panel and the approval gate agree without re-running. Scoped
  // to `seo` so the other engines' findings are untouched, and skipped entirely
  // when the check could not run — recording "no findings" for a check that
  // never looked would auto-resolve the real ones from last time.
  if (result.status !== "unchecked") {
    await syncFindings({ draftId: id, tenantId, incoming: result.findings, sources: ["seo"] });
  }

  return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { url?: unknown; keyword?: unknown };
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  if (!url || !keyword) {
    return NextResponse.json({ error: "url and keyword are required" }, { status: 400 });
  }

  const { supabase, tenantId } = await getTenantClient();
  const draft = await loadDraft(supabase, id);
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Re-run rather than trusting the posted pair. The body may have changed since
  // the panel was rendered, and a conflict that no longer exists should not be
  // "resolved" by inserting a link the draft does not need.
  const current = await checkBlogCannibalization({
    targetKeywords: keywordsOf(draft),
    title: (draft.title as string | null) ?? (draft.topic as string | null) ?? null,
  });
  const conflict = current.conflicts.find((c) => c.url === url && c.keyword === keyword);
  if (!conflict) {
    return NextResponse.json(
      { error: "That conflict is no longer reported — re-run the check." },
      { status: 409 },
    );
  }

  const source = typeof draft.body === "string" ? draft.body : "";
  const anchor = conflictAnchor(conflict);
  const linked = linkFirstMention(source, anchor, url);
  if (!linked) {
    return NextResponse.json(
      {
        error: source.includes(`](${url})`)
          ? "That page is already linked in the draft — the conflict needs the angle repositioned, not another link."
          : `Couldn't find "${anchor}" in the body to link. Add the mention, then resolve again.`,
      },
      { status: 422 },
    );
  }

  const { error: upErr } = await supabase
    .from("content_drafts")
    .update({ body: linked })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Re-check against the SAVED body so the findings reflect what is now stored.
  const after = await checkBlogCannibalization({
    targetKeywords: keywordsOf(draft),
    title: (draft.title as string | null) ?? (draft.topic as string | null) ?? null,
  });
  if (after.status !== "unchecked") {
    await syncFindings({ draftId: id, tenantId, incoming: after.findings, sources: ["seo"] });
  }

  return NextResponse.json({
    ok: true,
    linked: { anchor, url },
    remaining: after.conflicts.length,
    body: linked,
  });
}
