/**
 * POST /api/wp/applied
 *   header: X-KM-AutoPilot-Token: kmap_...
 *   body:   { id: string, applied_value: string, wp_post_id?: number,
 *             metadata?: object }
 *
 * Called by the WordPress plugin after it has successfully applied a fix.
 * Flips the row to status='applied' and records what was actually written.
 * Refuses if the row isn't in 'approved' status — keeps a stale plugin from
 * writing changes the marketer hasn't sanctioned.
 */

import { NextRequest, NextResponse } from "next/server";

import { authenticateToken, markApplied } from "@/lib/wp-autopilot";

export const runtime = "nodejs";

type Body = {
  id?: unknown;
  applied_value?: unknown;
  wp_post_id?: unknown;
  metadata?: unknown;
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
  const appliedValue = asString(body.applied_value);
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (!appliedValue) {
    return NextResponse.json(
      { error: "applied_value required" },
      { status: 400 },
    );
  }

  const wpPostIdRaw = body.wp_post_id;
  const wpPostId =
    typeof wpPostIdRaw === "number" && Number.isFinite(wpPostIdRaw)
      ? Math.round(wpPostIdRaw)
      : null;

  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  try {
    const updated = await markApplied({
      id,
      domain: auth.domain,
      tenantId: auth.tenantId,
      appliedValue,
      wpPostId,
      metadata,
    });
    return NextResponse.json({ ok: true, item: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "apply failed";
    const status = /not found|domain mismatch|status=/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
