/**
 * POST /api/content-production/social/rewrite
 *   body: { draftId, format, currentText, rejectedTexts?, reason }
 *
 * S12 (item 16): one more version of a single composer variation —
 * Rewrite (new angle), More engaging (stronger hook), or Change CTA.
 *
 * THE SOURCE IS LOADED HERE, NOT SENT
 *
 * Social generation is source-required (Rule 1), so a rewrite needs the
 * approved source text the post was drawn from. The composer does not have it:
 * the draft carries `metadata.social_source`, which is a title, a URL and an
 * id — a reference, not the text.
 *
 * So the route resolves it server-side, preferring the source DRAFT's body when
 * the page was authored here (exact, no network call) and falling back to
 * fetching the live page. Round-tripping the text through the browser would be
 * both wasteful and a way for edited copy to be passed off as the approved
 * source.
 *
 * Nothing is persisted. The composer holds versions in memory until the
 * reviewer schedules one, which is what makes reverting free — a rejected
 * version never became a row that has to be cleaned up.
 */

import { NextResponse } from "next/server";

import { rewriteSocialVariation } from "@/lib/content-social";
import { isRewriteReason, REWRITE_REASONS } from "@/lib/social-rewrite-reasons";
import { fetchPageText } from "@/lib/page-optimizer";
import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";
import { SOCIAL_CAPS, type SocialFormatKey } from "@/lib/social-format-rules";

export const runtime = "nodejs";
export const maxDuration = 60;

function isFormat(v: unknown): v is SocialFormatKey {
  return typeof v === "string" && v in SOCIAL_CAPS;
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
  const currentText = typeof body.currentText === "string" ? body.currentText : "";
  const reason = body.reason;
  const format = body.format;

  if (!isRewriteReason(reason)) {
    return NextResponse.json(
      { error: `reason must be one of: ${REWRITE_REASONS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!isFormat(format)) {
    return NextResponse.json({ error: "format is not a known social format" }, { status: 400 });
  }
  if (!currentText.trim()) {
    return NextResponse.json({ error: "currentText is required" }, { status: 400 });
  }
  if (!draftId) {
    return NextResponse.json(
      { error: "This variation has no source draft, so there is nothing to rewrite from." },
      { status: 400 },
    );
  }

  const rejectedTexts = Array.isArray(body.rejectedTexts)
    ? body.rejectedTexts.filter((t): t is string => typeof t === "string")
    : [];

  const db = await getTenantDb();

  // Read through the tenant-scoped client: a draft from another tenant reads as
  // missing, so this cannot be used to pull one firm's source text via another's
  // session.
  const { data: draft } = await db
    .from("content_drafts")
    .select("metadata, practice_area")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) {
    return NextResponse.json({ error: "Source draft not found." }, { status: 404 });
  }

  const meta = ((draft as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;
  const social = (meta.social_source ?? {}) as Record<string, unknown>;
  const sourceTitle = typeof social.title === "string" ? social.title : "";
  const sourceUrl = typeof social.url === "string" ? social.url : null;
  const sourceId = typeof social.id === "string" ? social.id : null;

  if (!sourceTitle) {
    return NextResponse.json(
      { error: "This draft has no recorded source, so a rewrite cannot be grounded in one." },
      { status: 422 },
    );
  }

  // Prefer the source draft's own body — exact, and no network round trip.
  let sourceText = "";
  if (sourceId) {
    const { data: src } = await db
      .from("content_drafts")
      .select("body")
      .eq("id", sourceId)
      .maybeSingle();
    const b = (src as { body?: unknown } | null)?.body;
    if (typeof b === "string") sourceText = b;
  }
  if (!sourceText.trim() && sourceUrl) {
    try {
      sourceText = await fetchPageText(sourceUrl);
    } catch {
      /* handled below — source is required */
    }
  }
  if (!sourceText.trim()) {
    return NextResponse.json(
      {
        error:
          "Couldn't read the source this post came from, so there is nothing to draw a new angle out of. Check the source page is reachable.",
      },
      { status: 422 },
    );
  }

  try {
    const out = await rewriteSocialVariation({
      source: {
        kind: "page",
        title: sourceTitle,
        text: sourceText,
        url: sourceUrl,
        id: sourceId,
      },
      format,
      currentText,
      rejectedTexts,
      reason,
      practiceArea:
        typeof (draft as Record<string, unknown>).practice_area === "string"
          ? ((draft as Record<string, unknown>).practice_area as string)
          : undefined,
      tenantId: db.tenantId,
    });
    return NextResponse.json({ ok: true, body: out.body, cta: out.cta });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Rewrite failed" },
      { status: 500 },
    );
  }
}
