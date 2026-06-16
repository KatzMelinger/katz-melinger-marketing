/**
 * POST /api/wp/failed
 *   header: X-KM-AutoPilot-Token: kmap_...
 *   body:   { id: string, reason: string, status?: 'failed' | 'needs_manual',
 *             wp_post_id?: number }
 *
 * Called by the WordPress plugin when it could NOT apply an approved fix.
 * Flips the row to 'failed' (a real error) or 'needs_manual' (fix_type the
 * plugin can't auto-apply) and records the reason. This takes the row out of
 * the approved-only fetch so the plugin stops re-attempting it every sync.
 * Mirror of /api/wp/applied — same token auth and approved-only guard.
 */

import { NextRequest, NextResponse } from "next/server";

import { authenticateToken, markFailed } from "@/lib/wp-autopilot";

export const runtime = "nodejs";

type Body = {
  id?: unknown;
  reason?: unknown;
  status?: unknown;
  wp_post_id?: unknown;
};

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-km-autopilot-token") ?? "";
  const auth = await authenticateToken(token);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const id = asString(body.id);
  const reason = asString(body.reason).trim() || "unspecified failure";
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const status = body.status === "needs_manual" ? "needs_manual" : "failed";

  const wpPostIdRaw = body.wp_post_id;
  const wpPostId =
    typeof wpPostIdRaw === "number" && Number.isFinite(wpPostIdRaw)
      ? Math.round(wpPostIdRaw)
      : null;

  try {
    const updated = await markFailed({
      id,
      domain: auth.domain,
      tenantId: auth.tenantId,
      reason,
      status,
      wpPostId,
    });
    return NextResponse.json({ ok: true, item: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "report failed";
    const httpStatus = /not found|domain mismatch|status=/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status: httpStatus });
  }
}
