/**
 * POST /api/content/drafts/[id]/publish
 *
 * The Publish step of the editorial loop (approved → published). This is where
 * content actually leaves the building:
 *   - re-runs the compliance HARD gate (never publish un-gated content — the
 *     body may have been edited after approval); a fail holds it at needs_legal.
 *   - social-surface drafts (format = a known Ayrshare platform) are posted via
 *     Ayrshare and recorded in social_posts; the returned permalink is written
 *     back and the site-inventory ingest fires.
 *   - long-form (blog) drafts are QUEUED for the WordPress pull plugin: they
 *     stay `approved` with metadata.wp_publish.queued, and the plugin creates
 *     the post + confirms via /api/wp/content/applied (which flips them to
 *     published). Email / other formats just advance the editorial status.
 *
 * Guard: only an `approved` draft can be published (enforces Approve→Publish).
 * On an external-publish failure the status is left at `approved` and the error
 * is surfaced — we never mark something published that didn't actually go out.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  runComplianceGate,
  surfaceForFormat,
} from "@/lib/agent/compliance-filter";
import { isWordPressFormat } from "@/lib/wp-content-publish";
import {
  AYRSHARE_PLATFORMS,
  getAyrshareApiKey,
  postToAyrshare,
  type AyrsharePlatform,
} from "@/lib/ayrshare";
import { guardUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOCIAL_PLATFORMS = new Set<string>(AYRSHARE_PLATFORMS);

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardUser();
  if (denied) return denied;
  const { id } = await params;

  const { supabase, tenantId } = await getTenantClient();

  const { data: draft, error } = await supabase
    .from("content_drafts")
    .select("id, status, body, title, format, practice_area, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (draft.status !== "approved") {
    return NextResponse.json(
      { error: `Only approved drafts can be published (status: ${draft.status}).` },
      { status: 409 },
    );
  }

  const body = typeof draft.body === "string" ? draft.body : "";
  const format = ((draft.format as string | null) ?? "blog").toLowerCase();
  // KM long-form page/article formats (including Redraft's km_page_update) publish
  // to WordPress and get blog-level compliance, even though surfaceForFormat()
  // buckets them as "other". Treat them as the blog surface here.
  const surface = isWordPressFormat(format) ? "blog" : surfaceForFormat(format);

  // Compliance HARD gate — fail-closed to needs_legal. The body can be edited
  // after approval, so we re-check at the moment of publishing.
  let verdict;
  try {
    verdict = await runComplianceGate({
      content: body,
      surface,
      practiceArea: (draft.practice_area as string | null) ?? undefined,
    });
  } catch {
    verdict = null;
  }
  if (!verdict || !verdict.pass) {
    const compliance = verdict
      ? {
          pass: verdict.pass,
          status: verdict.status,
          score: verdict.score,
          highSeverityCount: verdict.highSeverityCount,
          violations: verdict.violations.map((v) => ({
            rule: v.rule,
            severity: v.severity,
            reason: v.reason,
          })),
          suggestedRewrite: verdict.suggestedRewrite,
        }
      : { pass: false, status: "non_compliant", score: 0, error: "compliance check failed" };
    const mergedMetadata = {
      ...((draft.metadata as Record<string, unknown> | null) ?? {}),
      compliance,
    };
    await supabase
      .from("content_drafts")
      .update({ status: "needs_legal", metadata: mergedMetadata })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    await supabase
      .from("content_pipeline")
      .update({ status: "needs_legal" })
      .eq("draft_id", id)
      .eq("tenant_id", tenantId);
    return NextResponse.json(
      {
        error:
          "Held by the compliance gate — edit the draft to compliance before publishing.",
        status: "needs_legal",
        compliance,
      },
      { status: 422 },
    );
  }

  // Social publish via Ayrshare (only social-surface drafts whose format maps to
  // a known platform). Other formats advance editorially without external posting.
  let channel: "social" | "none" = "none";
  let publishedUrl: string | null = null;
  let postUrls: string[] = [];

  if (surface === "social" && SOCIAL_PLATFORMS.has(format)) {
    const apiKey = getAyrshareApiKey();
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Ayrshare is not configured (set AYRSHARE_API_KEY) — left as approved, nothing was posted.",
        },
        { status: 400 },
      );
    }
    const platform = format as AyrsharePlatform;
    const { ayrshareProfileKey } = await getTenantConfig(tenantId);
    const result = await postToAyrshare({
      apiKey,
      profileKey: ayrshareProfileKey,
      post: body,
      platforms: [platform],
    });
    if (!result.ok) {
      // Do NOT mark published — leave it approved and surface the failure.
      return NextResponse.json(
        { ok: false, error: "Social publish failed — left as approved.", result },
        { status: 502 },
      );
    }
    channel = "social";
    postUrls = (result.postIds ?? [])
      .map((p) => p.postUrl)
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    publishedUrl = postUrls[0] ?? null;
    try {
      await supabase.from("social_posts").insert([
        {
          tenant_id: tenantId,
          platform,
          content: body,
          ayrshare_id: result.id ?? null,
          post_url: publishedUrl,
          status: "published",
          published_at: new Date().toISOString(),
          source_draft_id: id,
        },
      ]);
    } catch {
      /* tracking insert is non-fatal — the post already went out */
    }
  } else if (surface === "blog") {
    // Long-form → queue for the WordPress pull plugin instead of posting here.
    // The draft stays `approved`; the plugin creates the post and confirms via
    // /api/wp/content/applied, which flips it to published.
    const prevMeta = (draft.metadata as Record<string, unknown> | null) ?? {};
    // A Redraft carries source_url → the plugin updates that page in place.
    const isUpdate =
      typeof prevMeta.source_url === "string" && prevMeta.source_url.trim().length > 0;
    const queuedMetadata = {
      ...prevMeta,
      wp_publish: { queued: true, queued_at: new Date().toISOString() },
    };
    await supabase
      .from("content_drafts")
      .update({ metadata: queuedMetadata })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    return NextResponse.json({
      ok: true,
      status: "queued",
      channel: "wordpress",
      message: isUpdate
        ? "Queued for WordPress — the site plugin will update the existing page in place on its next sync."
        : "Queued for WordPress — the site plugin will publish it on its next sync.",
    });
  }

  const mergedMetadata = {
    ...((draft.metadata as Record<string, unknown> | null) ?? {}),
    ...(publishedUrl ? { publishedUrl } : {}),
    publish: { channel, at: new Date().toISOString(), postUrls },
  };
  await supabase
    .from("content_drafts")
    .update({ status: "published", metadata: mergedMetadata })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  await supabase
    .from("content_pipeline")
    .update({ status: "published" })
    .eq("draft_id", id)
    .eq("tenant_id", tenantId);

  // Refresh the site_pages cluster map if we have a public URL (mirrors the
  // drafts PATCH publish behavior).
  if (publishedUrl && /^https?:\/\//i.test(publishedUrl)) {
    try {
      const { ingestUrls } = await import("@/lib/site-inventory");
      void ingestUrls([publishedUrl], tenantId).catch((err) =>
        console.warn("[publish] site-inventory ingest failed:", err),
      );
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({ ok: true, status: "published", channel, postUrls, publishedUrl });
}
