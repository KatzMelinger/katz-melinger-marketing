/**
 * GET /api/seo/gaps?view=striking|missing|clusters|states|language|questions
 *
 * Content gap views for the Opportunities page (Oct 6 spec, Task 18;
 * lib/content-gaps.ts). Search Console and DataForSEO data only.
 */
import { NextRequest, NextResponse } from "next/server";

import { contentGap, type GapView } from "@/lib/content-gaps";
import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VIEWS: GapView[] = ["striking", "missing", "clusters", "states", "language", "questions"];

export async function GET(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const view = req.nextUrl.searchParams.get("view") as GapView | null;
  if (!view || !VIEWS.includes(view)) return NextResponse.json({ error: "Unknown view" }, { status: 400 });
  try {
    return NextResponse.json(await contentGap(view, await resolveTenantId()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
