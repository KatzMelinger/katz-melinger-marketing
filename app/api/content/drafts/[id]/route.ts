/**
 * GET    /api/content/drafts/[id]   — fetch a single draft (with latest analysis)
 * PATCH  /api/content/drafts/[id]   — update title, body, metadata, status
 * DELETE /api/content/drafts/[id]   — remove
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import { findTimeSensitiveFacts } from "@/lib/freshness-check";
import { classifyFreshness } from "@/lib/freshness-classify";
import { getCurrentFacts } from "@/lib/current-facts-store";
import { isDraftStatus, isPipelineStatus } from "@/lib/content-status";
import { gatedStatusMessage, isGatedStatus } from "@/lib/content-transitions";
import { analysisStaleness, type AnalysisFingerprint } from "@/lib/analysis-fingerprint";

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

  // Staleness is computed here rather than in the client: it needs a hash of
  // the body and knowledge of the current engine, and the answer must be the
  // same one the approval gate uses. One source of truth, server-side.
  const latest = analyses?.[0] ?? null;
  const staleness = latest
    ? analysisStaleness(
        (latest as { scored_against?: AnalysisFingerprint | null }).scored_against,
        typeof (data as { body?: string }).body === "string" ? (data as { body: string }).body : "",
      )
    : null;

  return NextResponse.json({
    draft: data,
    latest_analysis: latest,
    analysis_staleness: staleness,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if ("status" in (body ?? {}) && !isDraftStatus(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  // A valid status is not necessarily one THIS route may write. approved /
  // published / needs_legal belong to the gated routes (see
  // lib/content-transitions.ts) — accepting them here is what let a draft reach
  // Approved without the compliance and freshness gates ever running.
  if (isGatedStatus(body?.status)) {
    return NextResponse.json(
      { error: gatedStatusMessage(body.status) },
      { status: 409 },
    );
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["title", "body", "metadata", "status", "practice_area"]) {
    if (key in (body ?? {})) patch[key] = body[key];
  }
  const { supabase, tenantId } = await getTenantClient();

  // When the body changes (a manual edit), recompute the time-sensitive-figure
  // gate so it can't go stale — otherwise a reviewer could edit a current figure
  // to a dated one and still pass the freshness QA gate (which reads
  // metadata.freshness). Merge into existing metadata; best-effort.
  if (typeof body?.body === "string") {
    try {
      const { data: existing } = await supabase
        .from("content_drafts")
        .select("metadata")
        .eq("id", id)
        .maybeSingle();
      const baseMeta =
        (patch.metadata as Record<string, unknown> | undefined) ??
        ((existing?.metadata as Record<string, unknown> | null) ?? {});
      const currentFacts = await getCurrentFacts(tenantId);
      const flags = classifyFreshness(findTimeSensitiveFacts(body.body), currentFacts);
      patch.metadata = { ...baseMeta, freshness: { flags } };
    } catch (e) {
      console.warn("[drafts] freshness recompute on edit failed:", e);
    }
  }

  const { data, error } = await supabase
    .from("content_drafts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The site_pages cluster-map refresh that used to live here fired on
  // `status === "published"`, which this route no longer accepts. The publish
  // route owns that ingest now (it has the real published URL in hand, rather
  // than guessing among six metadata keys), so this is not a lost behavior.

  if (isPipelineStatus(body?.status)) {
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
