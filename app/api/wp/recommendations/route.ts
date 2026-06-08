/**
 * GET /api/wp/recommendations
 *   header: X-KM-AutoPilot-Token: kmap_...
 *   query:  status (default 'approved')
 *
 * Returns the queue of approved on-page fixes for the calling plugin's domain.
 * The plugin polls this on a cron (default: every 15 minutes), applies each
 * fix, then POSTs to /api/wp/applied to confirm.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  authenticateToken,
  listRecommendations,
  type FixStatus,
} from "@/lib/wp-autopilot";

export const runtime = "nodejs";

const VALID_STATUSES: FixStatus[] = [
  "pending",
  "approved",
  "applied",
  "rejected",
  "reverted",
];

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-km-autopilot-token") ?? "";
  const auth = await authenticateToken(token);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "approved";
  const status = VALID_STATUSES.includes(statusParam as FixStatus)
    ? (statusParam as FixStatus)
    : "approved";

  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.round(limitParam), 1), 200)
    : 50;

  try {
    const items = await listRecommendations({
      domain: auth.domain,
      tenantId: auth.tenantId,
      status,
      limit,
    });
    return NextResponse.json({
      domain: auth.domain,
      status,
      count: items.length,
      items,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
