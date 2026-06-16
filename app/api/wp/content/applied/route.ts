/**
 * POST /api/wp/content/applied
 *   header: X-KM-AutoPilot-Token: kmap_...
 *   body:   { id: string, wp_post_id?: number, url?: string }
 *
 * Called by the WordPress plugin after it has created a post from a queued
 * long-form draft. Flips the draft (and its pipeline row) to `published`,
 * writes the public URL back, and refreshes the site inventory. Refuses unless
 * the draft is in `approved` status — a stale plugin can't publish rows the
 * marketer hasn't sanctioned. Companion to /api/wp/applied (on-page fixes).
 */

import { NextRequest, NextResponse } from "next/server";

import { authenticateToken } from "@/lib/wp-autopilot";
import { markWpContentPublished } from "@/lib/wp-content-publish";

export const runtime = "nodejs";

type Body = { id?: unknown; wp_post_id?: unknown; url?: unknown };

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-km-autopilot-token") ?? "";
  const auth = await authenticateToken(token);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const wpPostId =
    typeof body.wp_post_id === "number" && Number.isFinite(body.wp_post_id)
      ? Math.round(body.wp_post_id)
      : null;
  const url = typeof body.url === "string" ? body.url : null;

  try {
    const updated = await markWpContentPublished({
      id,
      tenantId: auth.tenantId,
      wpPostId,
      url,
    });
    return NextResponse.json({ ok: true, item: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "publish failed";
    const status = /not found|status=/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
