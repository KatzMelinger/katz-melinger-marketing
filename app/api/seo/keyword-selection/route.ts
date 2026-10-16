/**
 * POST /api/seo/keyword-selection   { title, keyword?, draftId? }
 *   -> KeywordDecision (lib/keyword-selection.ts)
 *
 * Oct 6 spec, Task 15: the brief wizard calls this before anything is
 * written, and shows the decision: the chosen keyword with its DataForSEO
 * volume, difficulty and date; the rejected candidates and why; and "New page"
 * or "Update of [URL]". The draft routes run the same pipeline themselves.
 */
import { NextRequest, NextResponse } from "next/server";

import { selectKeyword } from "@/lib/keyword-selection-data";
import { getCurrentUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { title?: unknown; keyword?: unknown; draftId?: unknown };
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const keyword = typeof b.keyword === "string" ? b.keyword.trim() : "";
  if (!title && !keyword) return NextResponse.json({ error: "title or keyword required" }, { status: 400 });
  try {
    const decision = await selectKeyword({
      tenantId: await resolveTenantId(),
      title: title || keyword,
      incoming: keyword || null,
      excludeDraftId: typeof b.draftId === "string" ? b.draftId : null,
    });
    return NextResponse.json(decision);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
