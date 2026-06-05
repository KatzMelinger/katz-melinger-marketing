/**
 * POST /api/content/drafts/[id]/verify-links
 *
 * Publishing-QA link check. Reads the draft body, extracts every link, and
 * verifies each internal link against the Cluster Map (site_pages) plus the
 * known-live pillar/hub URLs. Returns each link with a status:
 *   - confirmed   internal link → resolves to a live page
 *   - unverified  internal link → no matching live page (likely invented)
 *   - external    points off-site (reported, not gated)
 *
 * Optional body: { strip: true } removes unverified internal links from the
 * draft (unwrapping the anchor text) and persists the cleaned body.
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { verifyLinks } from "@/lib/link-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const strip = body?.strip === true;

  const supabase = getSupabaseAdmin();
  const { data: draft, error } = await supabase
    .from("content_drafts")
    .select("id, body")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const draftRow = draft as { id: string; body: string };
  const result = await verifyLinks(draftRow.body ?? "");

  if (strip && result.counts.unverified > 0) {
    let cleaned = draftRow.body ?? "";
    for (const link of result.links) {
      if (link.status !== "unverified") continue;
      // Markdown [anchor](href) → anchor; HTML <a href="href">anchor</a> → anchor.
      const esc = link.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cleaned = cleaned.replace(
        new RegExp(`\\[([^\\]]*)\\]\\(\\s*${esc}(?:\\s+"[^"]*")?\\s*\\)`, "g"),
        "$1",
      );
      cleaned = cleaned.replace(
        new RegExp(`<a\\b[^>]*\\bhref\\s*=\\s*["']${esc}["'][^>]*>([\\s\\S]*?)</a>`, "gi"),
        "$1",
      );
    }
    const { error: updErr } = await supabase
      .from("content_drafts")
      .update({ body: cleaned, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    const reverified = await verifyLinks(cleaned);
    return NextResponse.json({ ...reverified, stripped: true, body: cleaned });
  }

  return NextResponse.json(result);
}
