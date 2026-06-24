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
};

function isPlatform(p: unknown): p is AyrsharePlatform {
  return typeof p === "string" && (AYRSHARE_PLATFORMS as readonly string[]).includes(p);
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { posts?: IncomingPost[] };
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
    platform: string;
    scheduleDate: string;
    ok: boolean;
    viaAyrshare: boolean;
    error?: string;
  }[] = [];
  const rows: Record<string, unknown>[] = [];
  const editedDrafts = new Map<string, string>();

  for (const p of valid) {
    const platform = p.platform as AyrsharePlatform;
    const content = p.body.trim();
    if (p.draftId) editedDrafts.set(p.draftId, content);

    let ayrshareId: string | null = null;
    let postUrl: string | null = null;
    let viaAyrshare = false;
    let error: string | undefined;

    if (apiKey) {
      try {
        const res = await postToAyrshare({
          apiKey,
          profileKey: ayrshareProfileKey,
          post: content,
          platforms: [platform],
          scheduleDate: p.scheduleDate,
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
    }

    // Record on the calendar when it scheduled cleanly, or when Ayrshare isn't
    // connected at all (planned post). A real Ayrshare failure is reported, not
    // silently calendared as if it succeeded.
    const recorded = viaAyrshare || !apiKey;
    if (recorded) {
      rows.push({
        platform,
        content,
        ayrshare_id: ayrshareId,
        post_url: postUrl,
        status: "scheduled",
        scheduled_at: p.scheduleDate,
        published_at: null,
        source_draft_id: p.draftId ?? null,
      });
    }
    results.push({ platform, scheduleDate: p.scheduleDate, ok: recorded, viaAyrshare, error });
  }

  if (rows.length) await db.insert("social_posts", rows);

  // Persist any edits back onto the source drafts (best-effort, RLS-scoped).
  for (const [draftId, content] of editedDrafts) {
    await db.from("content_drafts").update({ body: content }).eq("id", draftId);
  }

  const scheduled = results.filter((r) => r.ok).length;
  const message = apiKey
    ? `${scheduled} of ${valid.length} post(s) scheduled. Review them on the Content Calendar.`
    : `${scheduled} post(s) added to the Content Calendar as planned posts. Connect Ayrshare to auto-publish them at their scheduled times.`;

  return NextResponse.json({
    ok: scheduled > 0,
    scheduled,
    total: valid.length,
    connected: !!apiKey,
    message,
    results,
  });
}
