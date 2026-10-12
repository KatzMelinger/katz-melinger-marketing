/**
 * GET    /api/content/drafts/[id]   — fetch a single draft (with latest analysis)
 * PATCH  /api/content/drafts/[id]   — update title, body, metadata, status
 * DELETE /api/content/drafts/[id]   — remove
 */

import { after, NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import { findTimeSensitiveFacts } from "@/lib/freshness-check";
import { classifyFreshness } from "@/lib/freshness-classify";
import { getCurrentFacts } from "@/lib/current-facts-store";
import { isDraftStatus, isPipelineStatus } from "@/lib/content-status";
import { gatedStatusMessage, isGatedStatus } from "@/lib/content-transitions";
import { analysisStaleness, fingerprintBody, type AnalysisFingerprint } from "@/lib/analysis-fingerprint";
import { analyzeDraft } from "@/lib/content-analysis";
import { getReadabilityConfig } from "@/lib/readability-config-store";
import { clearTextCertifications, dequeueWp, mergeClientMetadata } from "@/lib/draft-certifications";
import { recordAuditEvent } from "@/lib/content-findings-store";
import { getCurrentUser } from "@/lib/supabase-route";

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

  // Oct 6 spec, Task 21: a draft whose text changed since its checks ran
  // (a script, Fix known errors, Undo, another editor) is re-checked when it
  // is opened, so nobody reviews findings about a version that is gone. Only
  // for an EDITED body: an engine change or an unfingerprinted score would
  // re-run the whole library on first open. One run per body version.
  const draftBody = typeof (data as { body?: string }).body === "string" ? (data as { body: string }).body : "";
  if (staleness?.reason === "edited" && draftBody.trim()) {
    const key = `${id}:${fingerprintBody(draftBody)}`;
    const last = REANALYSIS_REQUESTED.get(key) ?? 0;
    if (Date.now() - last > 15 * 60_000) {
      REANALYSIS_REQUESTED.set(key, Date.now());
      const d = data as Record<string, unknown>;
      after(async () => {
        try {
          await analyzeDraft({
            draftId: id,
            body: draftBody,
            targetKeywords: (d.seo_brief as { targetKeywords?: string[] } | null)?.targetKeywords ?? [],
            title: (d.title as string | null) ?? null,
            topic: (d.topic as string | null) ?? null,
            format: (d.format as string | null) ?? null,
            template: (d.template as string | null) ?? null,
            practiceArea: (d.practice_area as string | null) ?? null,
            readabilityConfig: await getReadabilityConfig(tenantId),
            notify: false,
          });
        } catch (e) {
          console.warn("[drafts] re-check on open failed:", e);
        }
      });
    }
  }

  return NextResponse.json({
    draft: data,
    latest_analysis: latest,
    analysis_staleness: staleness,
  });
}

/** draftId:bodyHash -> when a re-check was last requested (per server instance). */
const REANALYSIS_REQUESTED = new Map<string, number>();

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

  const { data: existing, error: readError } = await supabase
    .from("content_drafts")
    .select("metadata, body, title, status")
    .eq("id", id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const storedMeta = (existing.metadata as Record<string, unknown> | null) ?? {};

  // wp_publish and certifications are server-owned (publish / certify routes).
  // A client metadata write keeps the stored values, so a PATCH can neither
  // queue a draft for WordPress nor forge a sign-off.
  let meta =
    "metadata" in (body ?? {})
      ? mergeClientMetadata(storedMeta, (body.metadata as Record<string, unknown> | null) ?? {})
      : storedMeta;
  let metaChanged = "metadata" in (body ?? {});
  const events: Array<{ event: string; detail: Record<string, unknown> }> = [];

  const textChanged =
    (typeof body?.body === "string" && body.body !== existing.body) ||
    (typeof body?.title === "string" && body.title !== existing.title);

  // When the body changes (a manual edit), recompute the time-sensitive-figure
  // gate so it can't go stale — otherwise a reviewer could edit a current figure
  // to a dated one and still pass the freshness QA gate (which reads
  // metadata.freshness). Best-effort.
  if (typeof body?.body === "string") {
    try {
      const currentFacts = await getCurrentFacts(tenantId);
      const flags = classifyFreshness(findTimeSensitiveFacts(body.body), currentFacts);
      meta = { ...meta, freshness: { flags } };
      metaChanged = true;
    } catch (e) {
      console.warn("[drafts] freshness recompute on edit failed:", e);
    }
  }

  if (textChanged) {
    // Sept 28 spec 11.5: a sign-off describes the text it was given on.
    const certs = clearTextCertifications(meta);
    if (certs.cleared.length > 0) {
      meta = certs.meta;
      metaChanged = true;
      events.push({ event: "certification_cleared", detail: { keys: certs.cleared, reason: "text edited" } });
    }
    // An approved draft that is edited is no longer the draft that was
    // approved. Back to review, and out of the WordPress queue, so the gates
    // run again before anything publishes (spec 11.9).
    if (existing.status === "approved" && !("status" in (body ?? {}))) {
      patch.status = "review";
      events.push({ event: "draft_reopened_by_edit", detail: { from: "approved" } });
    }
  }

  const nextStatus = (patch.status as string | undefined) ?? (existing.status as string);
  if (nextStatus !== "approved") {
    const dq = dequeueWp(meta, `Status is ${nextStatus}, not approved`);
    if (dq.changed) {
      meta = dq.meta;
      metaChanged = true;
      events.push({ event: "wp_dequeued", detail: { status: nextStatus } });
    }
  }

  if (metaChanged) patch.metadata = meta;
  else delete patch.metadata;

  const { data, error } = await supabase
    .from("content_drafts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (events.length > 0) {
    const user = await getCurrentUser();
    for (const e of events) {
      await recordAuditEvent({
        tenantId,
        draftId: id,
        event: e.event,
        actorUserId: user?.id ?? null,
        actorEmail: user?.email ?? null,
        detail: e.detail,
      });
    }
  }

  // The site_pages cluster-map refresh that used to live here fired on
  // `status === "published"`, which this route no longer accepts. The publish
  // route owns that ingest now (it has the real published URL in hand, rather
  // than guessing among six metadata keys), so this is not a lost behavior.

  const pipelineStatus = (patch.status as string | undefined) ?? body?.status;
  if (isPipelineStatus(pipelineStatus)) {
    const { data: pipelineRow } = await supabase
      .from("content_pipeline")
      .select("id")
      .eq("draft_id", id)
      .maybeSingle();

    if (pipelineRow) {
      await supabase
        .from("content_pipeline")
        .update({ status: pipelineStatus })
        .eq("id", (pipelineRow as { id: number }).id);
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
        status: pipelineStatus,
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
