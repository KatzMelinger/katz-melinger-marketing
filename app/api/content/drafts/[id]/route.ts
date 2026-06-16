/**
 * GET    /api/content/drafts/[id]   — fetch a single draft (with latest analysis)
 * PATCH  /api/content/drafts/[id]   — update title, body, metadata, status
 * DELETE /api/content/drafts/[id]   — remove
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("content_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: analyses } = await supabase
    .from("content_analyses")
    .select("*")
    .eq("draft_id", id)
    .order("created_at", { ascending: false })
    .limit(1);

  return NextResponse.json({ draft: data, latest_analysis: analyses?.[0] ?? null });
}

const VALID_DRAFT_STATUSES = [
  "initial_review",
  "idea",
  "brief",
  "draft",
  "review",
  "published",
  "approved",
  "archived",
] as const;

const PIPELINE_STATUSES = new Set([
  "idea",
  "brief",
  "draft",
  "review",
  "needs_legal",
  "approved",
  "published",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (
    "status" in (body ?? {}) &&
    !VALID_DRAFT_STATUSES.includes(body.status as (typeof VALID_DRAFT_STATUSES)[number])
  ) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["title", "body", "metadata", "status", "practice_area"]) {
    if (key in (body ?? {})) patch[key] = body[key];
  }
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("content_drafts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-refresh the site_pages cluster map when a draft is published. We
  // accept any of several metadata keys for the public URL, so as long as the
  // dashboard (or a future WP-publish hook) records one of them, the new page
  // lands in the inventory immediately. If no URL is set, the daily cron will
  // catch it within 24h.
  if (body?.status === "published") {
    try {
      const draftRow = data as { metadata?: Record<string, unknown> | null };
      const meta = (draftRow.metadata ?? {}) as Record<string, unknown>;
      const candidate =
        meta.publishedUrl ??
        meta.published_url ??
        meta.public_url ??
        meta.publicUrl ??
        meta.permalink ??
        meta.url;
      if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) {
        const { ingestUrls } = await import("@/lib/site-inventory");
        // Fire-and-forget — the PATCH response shouldn't wait on Claude.
        // Pass tenantId so the background ingest is scoped even off-request.
        void ingestUrls([candidate], tenantId).catch((err) =>
          console.warn("[drafts] site-inventory ingest failed:", err),
        );
      }
    } catch {
      /* non-fatal */
    }
  }

  if (typeof body?.status === "string" && PIPELINE_STATUSES.has(body.status)) {
    const { data: existing } = await supabase
      .from("content_pipeline")
      .select("id")
      .eq("draft_id", id)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("content_pipeline")
        .update({ status: body.status })
        .eq("id", (existing as { id: number }).id);
    } else {
      const draft = data as { title: string | null; topic: string; format: string };
      const contentType =
        draft.format === "blog"
          ? "website"
          : draft.format === "email"
            ? "email"
            : "social";
      await supabase.from("content_pipeline").insert({
        title: draft.title || draft.topic,
        status: body.status,
        bucket: "bofu_education",
        content_type: contentType,
        draft_id: id,
        tenant_id: tenantId,
      });
    }
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, tenantId } = await getTenantClient();
  const { error } = await supabase.from("content_drafts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
