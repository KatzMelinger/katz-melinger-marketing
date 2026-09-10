/**
 * Manage a single scheduled social post from the Content Calendar.
 *
 *   DELETE /api/social/posts/:id  — unschedule + remove it.
 *   PATCH  /api/social/posts/:id  — edit the caption and/or reschedule.
 *     body: { content?: string, scheduleDate?: ISO }
 *
 * Ayrshare can't edit a scheduled post in place, so a reschedule/edit is
 * delete-the-old + create-a-new one (re-attaching any stored media_urls). A
 * planned post (no ayrshare_id — Ayrshare wasn't connected when it was made) is
 * just updated in our table. Published posts are immutable from here.
 *
 * All reads/writes are RLS-scoped via getTenantDb.
 */

import { NextResponse } from "next/server";

import { getOperatingBrief } from "@/lib/social-operating-brief";
import { gateSocialPost, loadDraftCtaAndSourceBlog } from "@/lib/social-post-gate";
import { generateSpanishCompanion } from "@/lib/social-spanish";
import { isSocialFormat } from "@/lib/social-format-rules";
import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";
import {
  getAyrshareApiKey,
  postToAyrshare,
  deleteAyrsharePost,
  requiresMedia,
  type AyrsharePlatform,
} from "@/lib/ayrshare";

export const runtime = "nodejs";

type PostRow = {
  id: string;
  platform: string;
  content: string;
  status: string;
  scheduled_at: string | null;
  ayrshare_id: string | null;
  media_urls: string[] | null;
  source_draft_id: string | null;
};

async function loadPost(id: string) {
  const db = await getTenantDb();
  const full = "id, platform, content, status, scheduled_at, ayrshare_id, media_urls, source_draft_id";
  const res = await db.from("social_posts").select(full).eq("id", id).maybeSingle();
  // Degrade gracefully if media_urls/source_draft_id haven't been migrated yet.
  if (res.error && /media_urls|source_draft_id/i.test(res.error.message)) {
    const base = await db
      .from("social_posts")
      .select("id, platform, content, status, scheduled_at, ayrshare_id")
      .eq("id", id)
      .maybeSingle();
    return {
      db,
      row: base.data
        ? ({ ...(base.data as object), media_urls: null, source_draft_id: null } as PostRow)
        : null,
    };
  }
  return { db, row: (res.data as PostRow | null) ?? null };
}

/**
 * Spec: "Spanish companion posts... generated after the English version is
 * approved and length-matched." Fire-and-forget from the approve handler —
 * never delays or fails the English approval. Lands as a brand-new DRAFT
 * (never auto-scheduled), so it goes through the exact same compliance/legal/
 * S13 gates as any other post rather than skipping them as a "just a
 * translation" shortcut.
 */
async function queueSpanishCompanion(
  db: Awaited<ReturnType<typeof getTenantDb>>,
  row: PostRow,
): Promise<void> {
  if (!isSocialFormat(row.platform)) return; // carousel/video etc. — no 1:1 caption format to adapt
  const spanishBody = await generateSpanishCompanion(row.content, row.platform);
  if (!spanishBody?.trim()) return;

  const { data: draft, error: draftErr } = await db
    .insert("content_drafts", {
      format: row.platform,
      topic: "Spanish companion",
      title: `Spanish: ${row.content.slice(0, 80)}`,
      body: spanishBody,
      metadata: { language: "es", companion_of_post_id: row.id, source_draft_id: row.source_draft_id },
    })
    .select("id")
    .maybeSingle();
  if (draftErr || !draft) return;
  const draftId = draft.id as string;

  await db.insert("social_posts", {
    platform: row.platform,
    content: spanishBody,
    status: "draft",
    scheduled_at: row.scheduled_at,
    published_at: null,
    source_draft_id: draftId ?? null,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardUser();
  if (denied) return denied;
  const { id } = await params;

  const { db, row } = await loadPost(id);
  if (!row) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (row.status === "published") {
    return NextResponse.json(
      { error: "This post has already been published and can't be removed from here." },
      { status: 400 },
    );
  }

  // Cancel it on Ayrshare first (if it ever got there), so we don't orphan a
  // live scheduled post after deleting our row.
  const apiKey = getAyrshareApiKey();
  if (row.ayrshare_id && apiKey) {
    const profileKey = (await getTenantConfig(db.tenantId)).ayrshareProfileKey;
    const del = await deleteAyrsharePost({ apiKey, profileKey, id: row.ayrshare_id });
    if (!del.ok) {
      return NextResponse.json(
        { error: `Couldn't unschedule on Ayrshare: ${del.error}` },
        { status: 502 },
      );
    }
  }

  const { error } = await db.from("social_posts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, message: "Post unscheduled and removed." });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardUser();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    content?: string;
    scheduleDate?: string;
    approve?: boolean;
    clearFlag?: boolean;
  };

  // Clear a brand/compliance flag after human review: return a flagged post to
  // draft so it can be edited and approved. This is the deliberate "reviewed and
  // cleared" step the gate requires; it never publishes on its own.
  if (body.clearFlag === true) {
    const { db, row } = await loadPost(id);
    if (!row) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    if (row.status !== "flagged") {
      return NextResponse.json({ error: "This post isn't flagged." }, { status: 400 });
    }
    let { error } = await db
      .from("social_posts")
      .update({ status: "draft", last_error: null })
      .eq("id", id);
    // Degrade gracefully if last_error isn't migrated (same as the insert path);
    // otherwise a flagged post inserted without the column could never be cleared.
    if (error && /last_error/i.test(error.message)) {
      ({ error } = await db.from("social_posts").update({ status: "draft" }).eq("id", id));
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      message: "Flag cleared — the post is a draft again and can be approved.",
    });
  }

  // Approve a draft (the Phase 2 gate): send it to Ayrshare (if connected) and
  // flip draft → scheduled. Only a draft can be approved. Reuses the same
  // Ayrshare mechanics as the reschedule path below.
  if (body.approve === true) {
    const { db, row } = await loadPost(id);
    if (!row) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    if (row.status !== "draft") {
      return NextResponse.json({ error: "Only a draft can be approved." }, { status: 400 });
    }
    // Idempotency: a draft that already carries an ayrshare_id was published on a
    // prior attempt whose status write failed. Do NOT re-post (that would
    // double-publish) — just reconcile the status.
    if (row.ayrshare_id) {
      await db
        .from("social_posts")
        .update({ status: "scheduled" })
        .eq("id", id)
        .then(undefined, () => {});
      return NextResponse.json({
        ok: true,
        message: "Already scheduled on Ayrshare — status reconciled (not re-posted).",
      });
    }
    // Re-check the full gate at approval: a draft's caption may have been
    // edited to non-compliant copy after it was parked. Any hold re-flags the
    // post for review instead of publishing it. See lib/social-post-gate.ts.
    const [brief, draftMeta] = await Promise.all([
      getOperatingBrief(db.tenantId),
      loadDraftCtaAndSourceBlog(db, row.source_draft_id),
    ]);
    const gate = await gateSocialPost({
      content: row.content,
      platform: row.platform,
      draftId: row.source_draft_id,
      tenantId: db.tenantId,
      db,
      operatingBrief: brief,
      ctaType: draftMeta.ctaType,
      sourceBlogId: draftMeta.sourceBlogId,
    });
    // A legal-check infra failure (service down/timeout) is not a compliance
    // finding — don't hold the post over it. Leave status as-is and let the
    // reviewer retry, matching how the blog gate (app/api/agent/approve)
    // treats the same failure. But if something ELSE also flagged (a real
    // compliance issue or an inherited finding), that must still win — a
    // coincidental legal-check outage should never mask a genuine hold.
    const onlyLegalCheckFailed = gate.legalCheckFailed && gate.reasons.every((r) => r.startsWith("Legal review:"));
    if (onlyLegalCheckFailed) {
      return NextResponse.json(
        { error: "The legal-accuracy check could not run, so this was not approved. Try again." },
        { status: 503 },
      );
    }
    if (gate.flagged) {
      const message = gate.inheritedFindingHold
        ? `Flagged — ${gate.reasons.join("; ")}. Resolve the finding on the source blog, or clear the flag to override.`
        : `Flagged for review: ${gate.reasons.join("; ")}. Clear the flag after reviewing.`;
      await db
        .from("social_posts")
        .update({ status: "flagged", last_error: `Needs review: ${gate.reasons.join("; ")}` })
        .eq("id", id)
        .then(undefined, () => {});
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const platform = row.platform as AyrsharePlatform;
    const media = Array.isArray(row.media_urls) ? row.media_urls : [];
    const apiKey = getAyrshareApiKey();

    // No Ayrshare connected → approve as a planned scheduled post.
    if (!apiKey) {
      const { error } = await db.from("social_posts").update({ status: "scheduled" }).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      void queueSpanishCompanion(db, row).catch((e) => console.warn("[social/posts approve] Spanish companion failed:", e));
      return NextResponse.json({
        ok: true,
        message: "Approved. Scheduled as a planned post — connect Ayrshare to auto-publish it.",
      });
    }
    if (requiresMedia(platform) && media.length === 0) {
      return NextResponse.json(
        { error: `${platform} needs an image or video before it can be scheduled.` },
        { status: 400 },
      );
    }

    const profileKey = (await getTenantConfig(db.tenantId)).ayrshareProfileKey;
    // A draft's stored slot time may have elapsed by the time it's approved. If
    // it's still in the future, schedule for then; otherwise publish now — a past
    // scheduleDate is rejected by Ayrshare and would strand the draft as failed.
    const nowMs = Date.now();
    const futureAt =
      row.scheduled_at && new Date(row.scheduled_at).getTime() > nowMs ? row.scheduled_at : null;

    const res = await postToAyrshare({
      apiKey,
      profileKey,
      post: row.content,
      platforms: [platform],
      mediaUrls: media.length ? media : undefined,
      scheduleDate: futureAt ?? undefined,
      twitterThread: platform === "twitter",
    });
    if (!res.ok) {
      const reason = res.errors?.[0]?.message ?? "Ayrshare rejected the post.";
      await db
        .from("social_posts")
        .update({ status: "failed", last_error: reason })
        .eq("id", id)
        .then(undefined, () => {});
      return NextResponse.json({ error: reason }, { status: 502 });
    }
    // Success — record it. We intentionally do NOT write last_error here: a draft
    // has none to clear, and depending on that possibly-unmigrated column would
    // let this write fail AFTER Ayrshare accepted the post, leaving the row a
    // 'draft' that a retry would double-publish.
    const update: Record<string, unknown> = {
      ayrshare_id: res.id ?? null,
      post_url: res.postIds?.find((x) => x.platform === platform)?.postUrl ?? null,
    };
    if (futureAt) {
      update.status = "scheduled";
    } else {
      update.status = "published";
      update.published_at = new Date(nowMs).toISOString();
    }
    let updErr = (await db.from("social_posts").update(update).eq("id", id)).error;
    if (updErr) {
      // Retry persisting just the id + status (avoid a possibly-unmigrated column).
      updErr = (
        await db
          .from("social_posts")
          .update({ ayrshare_id: res.id ?? null, status: update.status })
          .eq("id", id)
      ).error;
    }
    if (updErr) {
      // Published on Ayrshare but the calendar row couldn't be updated. Do NOT
      // 500 — a retry would double-publish. Report success with a warning; the
      // idempotency guard above catches a retry if the id did persist.
      return NextResponse.json({
        ok: true,
        calendarError: updErr.message,
        message: `Published on Ayrshare, but the calendar status couldn't be saved (${updErr.message}). Do NOT re-approve — it's already out.`,
      });
    }
    void queueSpanishCompanion(db, row).catch((e) => console.warn("[social/posts approve] Spanish companion failed:", e));
    return NextResponse.json({
      ok: true,
      message: futureAt ? "Approved and scheduled." : "Approved and published.",
    });
  }

  const newContent = typeof body.content === "string" ? body.content.trim() : undefined;
  const newDate =
    typeof body.scheduleDate === "string" && !Number.isNaN(Date.parse(body.scheduleDate))
      ? body.scheduleDate
      : undefined;
  if (newContent === undefined && newDate === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  if (newContent !== undefined && !newContent) {
    return NextResponse.json({ error: "Caption can't be empty." }, { status: 400 });
  }

  const { db, row } = await loadPost(id);
  if (!row) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (row.status === "published") {
    return NextResponse.json(
      { error: "This post has already been published and can't be edited from here." },
      { status: 400 },
    );
  }

  const content = newContent ?? row.content;
  const scheduledAt = newDate ?? row.scheduled_at ?? undefined;
  const platform = row.platform as AyrsharePlatform;
  const media = Array.isArray(row.media_urls) ? row.media_urls : [];

  const apiKey = getAyrshareApiKey();

  // Planned post (never reached Ayrshare) → just update our row.
  if (!row.ayrshare_id || !apiKey) {
    const { error } = await db
      .from("social_posts")
      .update({ content, scheduled_at: scheduledAt })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, message: "Updated." });
  }

  // Real scheduled post → reschedule = delete + recreate on Ayrshare.
  if (requiresMedia(platform) && media.length === 0) {
    return NextResponse.json(
      { error: `${platform} needs an image or video — this post has no media to reschedule with.` },
      { status: 400 },
    );
  }

  const profileKey = (await getTenantConfig(db.tenantId)).ayrshareProfileKey;
  const del = await deleteAyrsharePost({ apiKey, profileKey, id: row.ayrshare_id });
  if (!del.ok) {
    return NextResponse.json(
      { error: `Couldn't update on Ayrshare: ${del.error}` },
      { status: 502 },
    );
  }

  const res = await postToAyrshare({
    apiKey,
    profileKey,
    post: content,
    platforms: [platform],
    mediaUrls: media.length ? media : undefined,
    scheduleDate: scheduledAt,
    twitterThread: platform === "twitter",
  });

  if (!res.ok) {
    // The old post is already gone; record the failure so the calendar shows why.
    const reason = res.errors?.[0]?.message ?? "Ayrshare rejected the updated post.";
    await db
      .from("social_posts")
      .update({ content, scheduled_at: scheduledAt, ayrshare_id: null, status: "failed", last_error: reason })
      .eq("id", id)
      .then(undefined, () => {});
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  let updErr = (
    await db
      .from("social_posts")
      .update({
        content,
        scheduled_at: scheduledAt,
        ayrshare_id: res.id ?? null,
        post_url: res.postIds?.find((x) => x.platform === platform)?.postUrl ?? null,
        status: "scheduled",
        last_error: null,
      })
      .eq("id", id)
  ).error;
  if (updErr) {
    // At minimum point the row at the NEW ayrshare_id, so a retry's guard doesn't
    // re-delete + re-create against the old (already-deleted) id.
    updErr = (
      await db
        .from("social_posts")
        .update({ ayrshare_id: res.id ?? null, status: "scheduled" })
        .eq("id", id)
    ).error;
  }
  if (updErr) {
    // The new post is live on Ayrshare; don't 500 (a retry would delete+recreate
    // again → duplicate). Report success with a warning.
    return NextResponse.json({
      ok: true,
      calendarError: updErr.message,
      message: `Rescheduled on Ayrshare, but the calendar couldn't be updated (${updErr.message}). Don't retry — it's already rescheduled.`,
    });
  }
  return NextResponse.json({ ok: true, message: "Post updated and rescheduled." });
}
