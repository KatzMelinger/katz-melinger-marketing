/**
 * GET  /api/content/results   results of published pages, the monthly check
 *      report, regression cases, live page scans and refresh requests
 * POST /api/content/results { action, id? }
 *      confirm_case   an attorney confirms Diana's fact correction (learned from then on)
 *      disable_case / enable_case   (Admins)
 *      measure_now / scan_now        run the daily jobs now (Admins)
 *
 * Oct 20 spec, Tasks A10 and A15.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { canClearLegalHold } from "@/lib/legal-reviewers";
import { measureDuePages, resultsOverview } from "@/lib/page-results";
import { confirmCase, listCases, runRegressionCases } from "@/lib/regression-cases";
import { listScans, scanDuePages } from "@/lib/live-page-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const tenantId = await resolveTenantId();
  const [overview, cases, scans, refresh] = await Promise.all([
    resultsOverview(tenantId),
    listCases(tenantId),
    listScans(tenantId),
    getSupabaseAdmin()
      .from("kb_refresh_requests")
      .select("kb_key, url, reason, draft_id, error, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const { count: livePages } = await getSupabaseAdmin()
    .from("site_pages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("page_type", ["blog_post", "practice_area", "pillar", "service_page"]);
  return NextResponse.json({
    ...overview,
    cases,
    scans,
    livePages: livePages ?? 0,
    refresh: refresh.error ? null : refresh.data,
    migrated: cases !== null && scans !== null && !refresh.error,
    canConfirm: canClearLegalHold(user.email),
    isAdmin: user.role === "admin",
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { action, id } = (await req.json().catch(() => ({}))) as { action?: string; id?: string };
  const tenantId = await resolveTenantId();
  if (action === "confirm_case") {
    if (!canClearLegalHold(user.email)) return NextResponse.json({ error: "Only a reviewing attorney can confirm a fact correction." }, { status: 403 });
    if (!id || !(await confirmCase(tenantId, id, user.email))) return NextResponse.json({ error: "Case not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  if (user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (action === "disable_case" || action === "enable_case") {
    const { error } = await getSupabaseAdmin().from("regression_cases").update({ enabled: action === "enable_case" }).eq("tenant_id", tenantId).eq("id", id ?? "");
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  if (action === "measure_now") {
    return NextResponse.json({ measured: await measureDuePages(tenantId), cases: await runRegressionCases(tenantId) });
  }
  if (action === "scan_now") {
    return NextResponse.json({ scan: await scanDuePages(tenantId, 5) });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
