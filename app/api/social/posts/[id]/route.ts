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
};

async function loadPost(id: string) {
  const db = await getTenantDb();
  const full = "id, platform, content, status, scheduled_at, ayrshare_id, media_urls";
  const res = await db.from("social_posts").select(full).eq("id", id).maybeSingle();
  // Degrade gracefully if media_urls hasn't been migrated yet.
  if (res.error && /media_urls/i.test(res.error.message)) {
    const base = await db
      .from("social_posts")
      .select("id, platform, content, status, scheduled_at, ayrshare_id")
      .eq("id", id)
      .maybeSingle();
    return { db, row: base.data ? ({ ...(base.data as object), media_urls: null } as PostRow) : null };
  }
  return { db, row: (res.data as PostRow | null) ?? null };
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
    const { error } = await db
      .from("social_posts")
      .update({ status: "draft", last_error: null })
      .eq("id", id);
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
    const platform = row.platform as AyrsharePlatform;
    const media = Array.isArray(row.media_urls) ? row.media_urls : [];
    const apiKey = getAyrshareApiKey();

    // No Ayrshare connected → approve as a planned scheduled post.
    if (!apiKey) {
      const { error } = await db.from("social_posts").update({ status: "scheduled" }).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
    const { error } = await db.from("social_posts").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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

  const { error } = await db
    .from("social_posts")
    .update({
      content,
      scheduled_at: scheduledAt,
      ayrshare_id: res.id ?? null,
      post_url: res.postIds?.find((x) => x.platform === platform)?.postUrl ?? null,
      status: "scheduled",
      last_error: null,
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, message: "Post updated and rescheduled." });
}
