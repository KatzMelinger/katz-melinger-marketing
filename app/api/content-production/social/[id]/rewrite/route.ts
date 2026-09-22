/**
 * POST /api/content-production/social/[id]/rewrite
 *   body: { action: "rewrite" | "more_engaging" | "cta_change" | "revert",
 *           platforms?: string[],   // Ayrshare-style platform ids this copy targets — for the gate
 *           versionId?: string }    // required for "revert"
 *
 * S12 — the composer's Rewrite / More engaging / Add-or-Change CTA buttons,
 * plus flipping back to an earlier version. One content_drafts row IS one
 * platform's copy (see lib/content-social.ts), so [id] is that draft's id.
 *
 * Every call:
 *   1. generates (or looks up, for revert) the new active text and appends it
 *      to the draft's version history (metadata.social_rewrite);
 *   2. persists the new body + history;
 *   3. re-runs the shared S3 QA + legal-accuracy gate (lib/social-post-gate.ts)
 *      against the NEW text, so Schedule can't be reached with a stale check;
 *   4. raises the social legal alert (6.14) if the gate found a legal problem,
 *      not just a logged finding.
 */

import { NextRequest, NextResponse } from "next/server";

import { guardUser, getCurrentUser } from "@/lib/supabase-route";
import { recordAuditEvent } from "@/lib/content-findings-store";
import { getTenantDb } from "@/lib/tenant-db";
import { isSocialFormat, type SocialFormatKey } from "@/lib/social-format-rules";
import {
  nextVersionId,
  regenerateSocialCopy,
  rejectedVersionIds,
  seedRewriteState,
  type RewriteAction,
  type RewriteState,
} from "@/lib/social-rewrite";
import type { SocialSource } from "@/lib/content-social";
import { gateSocialPost } from "@/lib/social-post-gate";
import { getOperatingBrief } from "@/lib/social-operating-brief";
import { sanitizeLinksForPlatform } from "@/lib/social-links";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACTIONS = new Set<string>(["rewrite", "more_engaging", "cta_change", "revert"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardUser();
  if (denied) return denied;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    platforms?: string[];
    versionId?: string;
  };
  if (!body.action || !ACTIONS.has(body.action)) {
    return NextResponse.json(
      { error: `action must be one of: ${[...ACTIONS].join(", ")}` },
      { status: 400 },
    );
  }
  const action = body.action as RewriteAction | "revert";

  const db = await getTenantDb();
  const { data: draft, error } = await db
    .from("content_drafts")
    .select("id, format, body, topic, practice_area, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSocialFormat(draft.format as string)) {
    return NextResponse.json({ error: "This draft is not a social post." }, { status: 400 });
  }
  const format = draft.format as SocialFormatKey;

  const meta = ((draft.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const state: RewriteState =
    (meta.social_rewrite as RewriteState | undefined) ?? seedRewriteState(draft.body as string);
  const currentText =
    state.versions.find((v) => v.version_id === state.active_version_id)?.text ?? (draft.body as string);

  let ctaPatch: { cta_type?: string; cta_mechanism?: string } = {};

  if (action === "revert") {
    if (!body.versionId) {
      return NextResponse.json({ error: "versionId is required for revert" }, { status: 400 });
    }
    const target = state.versions.find((v) => v.version_id === body.versionId);
    if (!target) return NextResponse.json({ error: "Unknown version id" }, { status: 400 });
    state.active_version_id = target.version_id;
  } else {
    const source = meta.social_source as (SocialSource & { text?: string }) | undefined;
    // Every version other than the current one is negative context for
    // "rewrite" — see lib/social-rewrite.ts's RewriteState note.
    const rejectedTexts = [currentText, ...rejectedVersionIds(state)
      .map((vid) => state.versions.find((v) => v.version_id === vid)?.text)
      .filter((t): t is string => !!t)];

    let result;
    try {
      result = await regenerateSocialCopy({
        action,
        format,
        currentText,
        rejectedTexts,
        source: source?.text ? { ...source, text: source.text } : undefined,
        practiceArea: draft.practice_area as string | null,
        tenantId: db.tenantId,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Rewrite failed" },
        { status: 422 },
      );
    }

    // 6.14 — strip any inherited tracking param and set the firm's own
    // per-channel UTM before this version is ever saved, same as at first
    // generation (lib/content-social.ts).
    const sanitized = sanitizeLinksForPlatform(result.body, format, draft.topic as string | null ?? undefined).body;

    state.versions.push({
      version_id: nextVersionId(state),
      text: sanitized,
      created_at: new Date().toISOString(),
      source: action,
    });
    state.active_version_id = state.versions[state.versions.length - 1].version_id;
    if (result.ctaType && result.ctaMechanism) {
      ctaPatch = { cta_type: result.ctaType, cta_mechanism: result.ctaMechanism };
    }
  }

  const newBody = state.versions.find((v) => v.version_id === state.active_version_id)!.text;
  const newMeta: Record<string, unknown> = { ...meta, ...ctaPatch, social_rewrite: state };

  const { error: updateErr } = await db
    .from("content_drafts")
    .update({ body: newBody, metadata: newMeta })
    .eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // 5.5/E5: the rewrite IS the "fix" spec 5.5 asks to be logged — who changed
  // this post's copy, by which action, and when.
  const actor = await getCurrentUser();
  await recordAuditEvent({
    tenantId: db.tenantId,
    draftId: id,
    event: `social_post_${action}`,
    actorUserId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    detail: { versionId: state.active_version_id },
  });

  // Re-run the same gate that runs at generation/schedule (S3 + 6.14) against
  // the NEW text, so the reviewer isn't the one who discovers a problem —
  // the sourceBlogId/ctaType come from the just-updated metadata, not the
  // stale pre-rewrite copy.
  const operatingBrief = await getOperatingBrief(db.tenantId);
  const gate = await gateSocialPost({
    content: newBody,
    platform: body.platforms,
    draftId: id,
    tenantId: db.tenantId,
    db,
    operatingBrief,
    ctaType: (newMeta.cta_type as string | undefined) ?? null,
    sourceBlogId: (newMeta.source_blog_id as string | undefined) ?? null,
  });

  // Alerting itself now lives inside gateSocialPost (lib/social-post-gate.ts)
  // so every call site gets it, not just this one — see that function's
  // legalCheck(). This just reads the same reasons back for the response.
  const legalReasons = gate.reasons.filter((r) => r.startsWith("Legal review:"));

  return NextResponse.json({
    body: newBody,
    ctaType: (newMeta.cta_type as string | undefined) ?? null,
    ctaMechanism: (newMeta.cta_mechanism as string | undefined) ?? null,
    rewrite: {
      active_version_id: state.active_version_id,
      versions: state.versions,
      rejected_version_ids: rejectedVersionIds(state),
    },
    gate: {
      flagged: gate.flagged,
      reasons: gate.reasons,
      legalFlagged: legalReasons.length > 0,
      legalCheckFailed: gate.legalCheckFailed,
    },
  });
}
