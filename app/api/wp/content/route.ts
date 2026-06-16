/**
 * GET /api/wp/content
 *   header: X-KM-AutoPilot-Token: kmap_...
 *   query:  status (only 'approved' is served), limit (1–200, default 50)
 *
 * The queue of long-form drafts the marketer has approved AND queued for
 * WordPress. The plugin polls this on its cron, creates a post from each
 * item's HTML, then POSTs /api/wp/content/applied to confirm. Companion to the
 * on-page-fix queue at /api/wp/recommendations.
 */

import { NextRequest, NextResponse } from "next/server";

import { authenticateToken } from "@/lib/wp-autopilot";
import { listApprovedWpContent } from "@/lib/wp-content-publish";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-km-autopilot-token") ?? "";
  const auth = await authenticateToken(token);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.round(limitParam), 1), 200)
    : 50;

  try {
    const items = await listApprovedWpContent({ tenantId: auth.tenantId, limit });
    return NextResponse.json({
      domain: auth.domain,
      status: "approved",
      count: items.length,
      items,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
