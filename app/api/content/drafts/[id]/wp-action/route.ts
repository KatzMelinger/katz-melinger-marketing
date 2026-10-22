/**
 * POST /api/content/drafts/[id]/wp-action   { action: "go_live" | "rollback" | "live_check" }
 *
 * Oct 20 spec, Task A12, after the WordPress plugin (0.7+) has saved a draft:
 *   go_live     publish the WordPress draft / pending version (the plugin does it on its next sync)
 *   rollback    restore the previous version of a published page
 *   live_check  check the live page again (frame, schema, canonical, indexable, links, redirects)
 * Publishing permission required (Admins and Brand settings "publishers").
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import { getCurrentUser } from "@/lib/supabase-route";
import { canPublish, withPublishLog } from "@/lib/publish-permission";
import { recordAuditEvent } from "@/lib/content-findings-store";
import { runLiveCheck } from "@/lib/live-page-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const { supabase, tenantId } = await getTenantClient();
  if (!(await canPublish(user, tenantId))) {
    return NextResponse.json({ error: "You do not have permission to publish." }, { status: 403 });
  }
  const { data: d } = await supabase.from("content_drafts").select("id, status, metadata").eq("id", id).maybeSingle();
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const meta = (d.metadata as Record<string, unknown> | null) ?? {};
  const wp = (meta.wp_publish as Record<string, unknown> | undefined) ?? {};
  const now = new Date().toISOString();

  if (action === "live_check") {
    const url = (wp.url as string | undefined) ?? (meta.publishedUrl as string | undefined);
    if (d.status !== "published" || !url) return NextResponse.json({ error: "Only a published page with a URL can be checked." }, { status: 409 });
    const check = await runLiveCheck({ tenantId, draftId: id, url });
    return NextResponse.json({ liveCheck: check });
  }

  let next: Record<string, unknown>;
  if (action === "go_live") {
    if (d.status !== "approved" || wp.state !== "wp_draft") {
      return NextResponse.json({ error: "Publish live needs a WordPress draft saved by the plugin first." }, { status: 409 });
    }
    next = withPublishLog({ ...meta, wp_publish: { ...wp, go_live_requested: true, go_live_by: user.email, go_live_at: now } }, { action: "go_live", by: user.email, at: now });
  } else if (action === "rollback") {
    if (d.status !== "published" || typeof wp.wp_post_id !== "number") {
      return NextResponse.json({ error: "Only a page published through the plugin can be rolled back." }, { status: 409 });
    }
    next = { ...meta, wp_publish: { ...wp, rollback_requested: true, rollback_by: user.email, rollback_at: now } };
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const { error } = await supabase.from("content_drafts").update({ metadata: next }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recordAuditEvent({ tenantId, draftId: id, event: `wp_${action}_requested`, actorUserId: user.id, actorEmail: user.email, detail: {} });
  return NextResponse.json({
    ok: true,
    message:
      action === "go_live"
        ? "Requested: the site plugin publishes it on its next sync."
        : "Requested: the site plugin restores the previous version on its next sync.",
  });
}
