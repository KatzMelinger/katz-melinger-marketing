/**
 * GET  /api/content/drafts/[id]/versions            every saved version (Task A17)
 * POST /api/content/drafts/[id]/versions { versionId }  restore one
 *
 * A restore keeps the current text as a version first, puts the article back
 * in the current frame (so Brand settings still apply), and, like any text
 * change, clears the sign-offs and the attorney's clearance.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import { getCurrentUser } from "@/lib/supabase-route";
import { getVersion, listVersions, saveVersion } from "@/lib/draft-versions";
import { isFramedFormat } from "@/lib/draft-frame";
import { frameDraft } from "@/lib/draft-frame-server";
import { clearTextCertifications } from "@/lib/draft-certifications";
import { recordAuditEvent } from "@/lib/content-findings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenantId, supabase } = await getTenantClient();
  const { data: d } = await supabase.from("content_drafts").select("id").eq("id", id).maybeSingle();
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const versions = await listVersions(tenantId, id);
  return NextResponse.json({ versions: versions ?? [], recorded: versions !== null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const { versionId } = (await req.json().catch(() => ({}))) as { versionId?: string };
  if (!versionId) return NextResponse.json({ error: "versionId required" }, { status: 400 });
  const { tenantId, supabase } = await getTenantClient();
  const { data: d } = await supabase.from("content_drafts").select("id, status, title, topic, body, format, practice_area, metadata").eq("id", id).maybeSingle();
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (["archived", "published"].includes(d.status as string)) {
    return NextResponse.json({ error: `A ${d.status} draft cannot be restored here.` }, { status: 409 });
  }
  const v = await getVersion(tenantId, id, versionId);
  if (!v) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const meta = (d.metadata as Record<string, unknown> | null) ?? {};
  await saveVersion({ tenantId, draftId: id, title: (d.title as string | null) ?? null, body: (d.body as string | null) ?? null, content: meta.content, reason: "before a restore", by: user.email });

  let body = v.body;
  let nextMeta = clearTextCertifications(meta).meta;
  if (isFramedFormat(d.format as string | null)) {
    const framed = await frameDraft(tenantId, { body: v.body, title: v.title ?? (d.title as string | null), topic: d.topic as string | null, format: d.format as string, practice_area: d.practice_area as string | null, metadata: nextMeta });
    if (framed) {
      body = framed.body;
      nextMeta = framed.metadata;
    }
  }
  const { error } = await supabase
    .from("content_drafts")
    .update({ body, title: v.title ?? d.title, metadata: nextMeta, status: d.status === "approved" ? "review" : d.status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recordAuditEvent({ tenantId, draftId: id, event: "version_restored", actorUserId: user.id, actorEmail: user.email, detail: { versionId } });
  return NextResponse.json({ ok: true });
}
