/**
 * POST /api/wp/content/applied
 *   header: X-KM-AutoPilot-Token: kmap_...
 *   body:   { id: string, wp_post_id?: number, url?: string,
 *             state?: "wp_draft" | "published" | "rolled_back", preview_url?: string }
 *
 * Called by the WordPress plugin after it has created a post from a queued
 * long-form draft. Flips the draft (and its pipeline row) to `published`,
 * writes the public URL back, and refreshes the site inventory. Refuses unless
 * the draft is in `approved` status — a stale plugin can't publish rows the
 * marketer hasn't sanctioned. Companion to /api/wp/applied (on-page fixes).
 */

import { NextRequest, NextResponse } from "next/server";

import { authenticateToken } from "@/lib/wp-autopilot";
import { after } from "next/server";
import { confirmWpContent } from "@/lib/wp-content-publish";
import { runLiveCheck } from "@/lib/live-page-check";

export const runtime = "nodejs";

type Body = { id?: unknown; wp_post_id?: unknown; url?: unknown; state?: unknown; preview_url?: unknown };

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
    const updated = await confirmWpContent({
      id,
      tenantId: auth.tenantId,
      wpPostId,
      url,
      state: typeof body.state === "string" ? body.state : null,
      previewUrl: typeof body.preview_url === "string" ? body.preview_url : null,
    });
    // Oct 20 spec, Task A12: the live page is checked once it is published.
    if (updated.state === "published" && updated.url) {
      const tenantId = auth.tenantId;
      after(() => runLiveCheck({ tenantId, draftId: id, url: updated.url! }).catch((e) => console.warn("[wp] live check failed:", e)));
    }
    return NextResponse.json({ ok: true, item: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "publish failed";
    const status = /not found|status=/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
