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

import { checkSocialCompliance } from "@/lib/social-compliance";
import { checkCalendarDuplicates, type AngleConflict } from "@/lib/social-duplicate";
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

  const body = (await req.json().catch(() => ({}))) as {
    posts?: IncomingPost[];
    asDraft?: boolean;
    /** The composer already showed the duplicate alert and the user acknowledged
     *  it, so don't re-flag near-duplicates as needing review. */
    ackDuplicates?: boolean;
  };
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

  // Feature 8 — duplicate/angle gate: compare every candidate against the whole
  // Content Calendar (semantically, not exact-text) up front. A near-duplicate
  // is flagged for review below (named by its matching post) and can't schedule
  // until a human clears it. Fails soft — a check error never blocks scheduling.
  let dupConflicts: AngleConflict[][] = valid.map(() => []);
  if (body.ackDuplicates !== true) {
    try {
      const dup = await checkCalendarDuplicates({
        tenantId: db.tenantId,
        candidates: valid.map((p) => ({ body: p.body })),
      });
      if (dup.ran) dupConflicts = dup.conflicts;
    } catch {
      /* advisory — never block scheduling on a check failure */
    }
  }

  const results: {
    draftId: string | null;
    platform: string;
    scheduleDate: string;
    ok: boolean;
    status: "draft" | "scheduled" | "failed" | "flagged";
    viaAyrshare: boolean;
    error?: string;
  }[] = [];
  const rows: Record<string, unknown>[] = [];
  const editedDrafts = new Map<string, string>();

  for (const [i, p] of valid.entries()) {
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

    // Brand/compliance gate (server-side enforcement of the composer's flag): a
    // blocking flag can neither publish nor schedule. It lands on the calendar as
    // "flagged" with the reason, and a human must clear it (review + override)
    // before it can be approved. This backstops the client gate so a flagged
    // draft can't be quietly approved from the calendar later.
    const blockingFlags = checkSocialCompliance(content).filter((f) => f.severity === "block");
    const dupConflict = dupConflicts[i]?.[0] ?? null;
    const flagged = blockingFlags.length > 0 || !!dupConflict;

    // Guaranteed-fail guard: media-required platforms (Instagram, TikTok, etc.)
    // can't post text-only. Fail fast with a clear reason instead of spending an
    // Ayrshare call to get code 139 back.
    // Drafts can be incomplete (no media yet), so we don't block them here.
    const blockedForMedia = !asDraft && requiresMedia(platform) && mediaUrls.length === 0;

    if (!flagged && !asDraft && apiKey && !blockedForMedia) {
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
    const status: "draft" | "scheduled" | "failed" | "flagged" = flagged
      ? "flagged"
      : asDraft
        ? "draft"
        : error
          ? "failed"
          : "scheduled";
    // A flagged post carries the reason in last_error so the calendar can show
    // why it's held; a real publish error carries the Ayrshare reason.
    const flagReasons = [...blockingFlags.map((f) => f.label)];
    if (dupConflict) {
      const when = new Date(dupConflict.date);
      const whenStr = Number.isNaN(when.getTime()) ? "" : ` on ${when.toISOString().slice(0, 10)}`;
      flagReasons.push(
        dupConflict.reason === "same-source"
          ? `Same source already posted (${dupConflict.platform}${whenStr})`
          : `Similar angle already scheduled (${dupConflict.platform}${whenStr})`,
      );
    }
    const lastError = flagged ? `Needs review: ${flagReasons.join("; ")}` : error ?? null;
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
      last_error: lastError,
      media_urls: mediaUrls.length ? mediaUrls : null,
    });
    results.push({
      draftId: p.draftId ?? null,
      platform,
      scheduleDate: p.scheduleDate,
      ok: status !== "failed" && status !== "flagged",
      status,
      viaAyrshare,
      error: (flagged ? lastError : error) ?? undefined,
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
  const flaggedCount = results.filter((r) => r.status === "flagged").length;
  const flagNote = flaggedCount
    ? ` ${flaggedCount} post(s) were flagged for brand/compliance review — clear the flag on the calendar before they can schedule.`
    : "";

  let message: string;
  if (asDraft) {
    message = `${drafted} post(s) saved as drafts on the Content Calendar. Approve each one to schedule it.${flagNote}`;
  } else if (!apiKey) {
    message = `${scheduled} post(s) added to the Content Calendar as planned posts. Connect Ayrshare to auto-publish them at their scheduled times.`;
  } else if (failed === 0) {
    message = `${scheduled} of ${valid.length} post(s) scheduled. Review them on the Content Calendar.${flagNote}`;
  } else if (scheduled === 0) {
    message = `Ayrshare rejected all ${failed} post(s) — see the reasons below. They're on the Content Calendar marked “failed”.${flagNote}`;
  } else {
    message = `${scheduled} of ${valid.length} post(s) scheduled. ${failed} were rejected by Ayrshare — see the reasons below.${flagNote}`;
  }

  return NextResponse.json({
    // Something always landed on the calendar; the drawer decides tone from `failed`.
    ok: rows.length > 0,
    scheduled,
    failed,
    flagged: flaggedCount,
    drafted,
    total: valid.length,
    connected: !!apiKey,
    message,
    results,
  });
}
