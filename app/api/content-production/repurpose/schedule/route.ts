/**
 * POST /api/content-production/repurpose/schedule
 *   body: { posts: [{ draftId?, platform, body, scheduleDate (ISO), format? }] }
 *
 * Step 2 of the Repurpose-into-social workflow: schedule only the variations the
 * human kept (and possibly edited) in the review drawer. One incoming entry =
 * one post (one platform, one time).
 *
 *   - If Ayrshare is connected, each post is scheduled there and recorded in
 *     social_posts (status "scheduled", with the real ayrshare_id) so it shows
 *     on the Content Calendar and publishes at its time.
 *   - If Ayrshare is NOT connected, the posts are still recorded on the calendar
 *     as planned posts (no ayrshare_id) — connecting Ayrshare later is what turns
 *     planned into auto-published. We say so in the response.
 *
 * Edited bodies are written back to the source content_draft (best-effort) so
 * the Drafts library reflects what was actually scheduled.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";
import {
  AYRSHARE_PLATFORMS,
  getAyrshareApiKey,
  postToAyrshare,
  requiresMedia,
  type AyrsharePlatform,
} from "@/lib/ayrshare";

export const runtime = "nodejs";
export const maxDuration = 60;

type IncomingPost = {
  draftId?: string | null;
  format?: string | null;
  platform?: string;
  body?: string;
  scheduleDate?: string;
  /** Slide/asset image URLs to attach (carousel). Must be public HTTPS. */
  mediaUrls?: string[];
};

function isPlatform(p: unknown): p is AyrsharePlatform {
  return typeof p === "string" && (AYRSHARE_PLATFORMS as readonly string[]).includes(p);
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { posts?: IncomingPost[]; asDraft?: boolean };
  // Draft-first: when asDraft, persist the posts as drafts on the Content
  // Calendar without touching Ayrshare. Approving a draft (from the calendar)
  // is what sends it to Ayrshare and flips it to scheduled. Default (false)
  // keeps the existing schedule-now behavior unchanged.
  const asDraft = body.asDraft === true;
  const incoming = Array.isArray(body.posts) ? body.posts : [];
  if (!incoming.length) {
    return NextResponse.json({ error: "no posts to schedule" }, { status: 400 });
  }

  // Keep only well-formed posts: a real platform, non-empty body, valid time.
  const valid = incoming.filter(
    (p): p is Required<Pick<IncomingPost, "platform" | "body" | "scheduleDate">> & IncomingPost =>
      !!p &&
      isPlatform(p.platform) &&
      typeof p.body === "string" &&
      p.body.trim().length > 0 &&
      typeof p.scheduleDate === "string" &&
      !Number.isNaN(Date.parse(p.scheduleDate)),
  );
  if (!valid.length) {
    return NextResponse.json({ error: "no valid posts to schedule" }, { status: 400 });
  }

  const db = await getTenantDb();
  const apiKey = getAyrshareApiKey();
  const ayrshareProfileKey = apiKey ? (await getTenantConfig(db.tenantId)).ayrshareProfileKey : null;

  const results: {
    draftId: string | null;
    platform: string;
    scheduleDate: string;
    ok: boolean;
    status: "draft" | "scheduled" | "failed";
    viaAyrshare: boolean;
    error?: string;
  }[] = [];
  const rows: Record<string, unknown>[] = [];
  const editedDrafts = new Map<string, string>();

  for (const p of valid) {
    const platform = p.platform as AyrsharePlatform;
    const content = p.body.trim();
    if (p.draftId) editedDrafts.set(p.draftId, content);

    // Carousel / asset images to attach. Ayrshare requires public HTTPS URLs.
    const mediaUrls = Array.isArray(p.mediaUrls)
      ? p.mediaUrls.filter((u): u is string => typeof u === "string" && u.startsWith("https://"))
      : [];

    let ayrshareId: string | null = null;
    let postUrl: string | null = null;
    let viaAyrshare = false;
    let error: string | undefined;

    // Guaranteed-fail guard: media-required platforms (Instagram, TikTok, etc.)
    // can't post text-only. Fail fast with a clear reason instead of spending an
    // Ayrshare call to get code 139 back.
    // Drafts can be incomplete (no media yet), so we don't block them here.
    const blockedForMedia = !asDraft && requiresMedia(platform) && mediaUrls.length === 0;

    if (!asDraft && apiKey && !blockedForMedia) {
      try {
        const res = await postToAyrshare({
          apiKey,
          profileKey: ayrshareProfileKey,
          post: content,
          platforms: [platform],
          mediaUrls: mediaUrls.length ? mediaUrls : undefined,
          scheduleDate: p.scheduleDate,
          // Long X posts (our threads) auto-split instead of being rejected >280.
          twitterThread: platform === "twitter",
        });
        if (res.ok) {
          viaAyrshare = true;
          ayrshareId = res.id ?? null;
          postUrl = res.postIds?.find((x) => x.platform === platform)?.postUrl ?? null;
        } else {
          error = res.errors?.[0]?.message ?? "Ayrshare rejected the post";
        }
      } catch (e) {
        error = e instanceof Error ? e.message : "schedule failed";
      }
    } else if (blockedForMedia) {
      error = `${platform} requires an image or video — attach media (e.g. generate carousel slides) or choose a text channel like LinkedIn, Facebook, or X.`;
    }

    // Every post lands on the calendar so the workflow is never silently
    // blocked. The status records what actually happened:
    //   - "scheduled": accepted by Ayrshare (real ayrshare_id), OR Ayrshare
    //     isn't connected at all so it's a planned post (no id) to publish later.
    //   - "failed": Ayrshare is connected but rejected this post. We keep it on
    //     the calendar (so intent is visible) and surface the reason to the UI
    //     instead of dropping it on the floor.
    // Failed when Ayrshare rejected it, or we blocked it as a guaranteed fail.
    // A planned post (no Ayrshare) with no block stays "scheduled".
    const status: "draft" | "scheduled" | "failed" = asDraft
      ? "draft"
      : error
        ? "failed"
        : "scheduled";
    if (error) {
      console.error(
        `[repurpose/schedule] ${platform} rejected (draft ${p.draftId ?? "—"}): ${error}`,
      );
    }
    rows.push({
      platform,
      content,
      ayrshare_id: ayrshareId,
      post_url: postUrl,
      status,
      scheduled_at: p.scheduleDate,
      published_at: null,
      source_draft_id: p.draftId ?? null,
      last_error: error ?? null,
      media_urls: mediaUrls.length ? mediaUrls : null,
    });
    results.push({
      draftId: p.draftId ?? null,
      platform,
      scheduleDate: p.scheduleDate,
      ok: status !== "failed",
      status,
      viaAyrshare,
      error,
    });
  }

  if (rows.length) {
    let ins = await db.insert("social_posts", rows);
    // Stay resilient if the new columns haven't been migrated yet: retry without
    // them (reasons still return to the UI and are logged above).
    if (ins.error && /last_error|media_urls/i.test(ins.error.message)) {
      ins = await db.insert(
        "social_posts",
        rows.map((r) => {
          const copy = { ...r };
          delete copy.last_error;
          delete copy.media_urls;
          return copy;
        }),
      );
    }
    // Any other insert failure is real — surface it instead of reporting a
    // fabricated success (nothing actually landed on the calendar).
    if (ins.error) {
      return NextResponse.json(
        { error: `Could not save to the Content Calendar: ${ins.error.message}` },
        { status: 500 },
      );
    }
  }

  // Persist any edits back onto the source drafts (best-effort, RLS-scoped).
  for (const [draftId, content] of editedDrafts) {
    await db.from("content_drafts").update({ body: content }).eq("id", draftId);
  }

  const scheduled = results.filter((r) => r.status === "scheduled").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const drafted = results.filter((r) => r.status === "draft").length;

  let message: string;
  if (asDraft) {
    message = `${drafted} post(s) saved as drafts on the Content Calendar. Approve each one to schedule it.`;
  } else if (!apiKey) {
    message = `${scheduled} post(s) added to the Content Calendar as planned posts. Connect Ayrshare to auto-publish them at their scheduled times.`;
  } else if (failed === 0) {
    message = `${scheduled} of ${valid.length} post(s) scheduled. Review them on the Content Calendar.`;
  } else if (scheduled === 0) {
    message = `Ayrshare rejected all ${failed} post(s) — see the reasons below. They're on the Content Calendar marked “failed”.`;
  } else {
    message = `${scheduled} of ${valid.length} post(s) scheduled. ${failed} were rejected by Ayrshare — see the reasons below.`;
  }

  return NextResponse.json({
    // Something always landed on the calendar; the drawer decides tone from `failed`.
    ok: rows.length > 0,
    scheduled,
    failed,
    drafted,
    total: valid.length,
    connected: !!apiKey,
    message,
    results,
  });
}
