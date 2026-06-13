/**
 * POST /api/social/ayrshare/publish
 *
 * Publishes (or schedules) a social post via Ayrshare and records the result
 * in social_posts. Body:
 *   {
 *     post: string,                 // caption / text
 *     platforms: string[],          // e.g. ["linkedin","facebook","instagram"]
 *     mediaUrls?: string[],         // https image/video URLs
 *     scheduleDate?: string,        // UTC ISO "YYYY-MM-DDThh:mm:ssZ" → schedules
 *     draftId?: string              // content_drafts.id this came from, if any
 *   }
 *
 * Auth/credentials: AYRSHARE_API_KEY (account key) + optional per-tenant
 * Profile-Key from tenant_settings. Writes are tenant-stamped via getTenantDb.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  AYRSHARE_PLATFORMS,
  getAyrshareApiKey,
  postToAyrshare,
  type AyrsharePlatform,
} from "@/lib/ayrshare";
import { guardUser } from "@/lib/supabase-route";
import { getTenantConfig } from "@/lib/tenant-config";
import { getTenantDb } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED = new Set<string>(AYRSHARE_PLATFORMS);

export async function POST(request: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const apiKey = getAyrshareApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Ayrshare is not configured. Set AYRSHARE_API_KEY." },
      { status: 400 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const post = typeof obj.post === "string" ? obj.post : "";
  const platforms = (Array.isArray(obj.platforms) ? obj.platforms : []).filter(
    (p): p is AyrsharePlatform => typeof p === "string" && ALLOWED.has(p),
  );
  if (platforms.length === 0) {
    return NextResponse.json(
      { error: `platforms must be a non-empty array of: ${[...ALLOWED].join(", ")}` },
      { status: 400 },
    );
  }
  if (!post.trim() && platforms.length > 0) {
    // Ayrshare technically accepts an empty post, but for our flows an empty
    // caption with no media is almost always a mistake.
    const hasMedia = Array.isArray(obj.mediaUrls) && obj.mediaUrls.length > 0;
    if (!hasMedia) {
      return NextResponse.json({ error: "post text or mediaUrls is required" }, { status: 400 });
    }
  }
  const mediaUrls = Array.isArray(obj.mediaUrls)
    ? obj.mediaUrls.filter((u): u is string => typeof u === "string" && u.startsWith("https://"))
    : undefined;
  const scheduleDate = typeof obj.scheduleDate === "string" ? obj.scheduleDate : undefined;
  const draftId = typeof obj.draftId === "string" ? obj.draftId : null;

  // Per-tenant Profile-Key (optional; multi-account Ayrshare Business).
  const db = await getTenantDb();
  const { ayrshareProfileKey } = await getTenantConfig(db.tenantId);

  const result = await postToAyrshare({
    apiKey,
    profileKey: ayrshareProfileKey,
    post,
    platforms,
    mediaUrls,
    scheduleDate,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, result }, { status: 502 });
  }

  // Record one row per platform (best-effort — a logging failure must not make
  // the caller think the publish failed, since Ayrshare already accepted it).
  const scheduled = result.status === "scheduled";
  const now = new Date().toISOString();
  const rows = platforms.map((platform) => {
    const pid = result.postIds?.find((p) => p.platform === platform);
    return {
      platform,
      body: post,
      ayrshare_id: result.id ?? null,
      post_url: pid?.postUrl ?? null,
      status: scheduled ? "scheduled" : "published",
      scheduled_at: scheduled ? (result.scheduleDate ?? scheduleDate ?? null) : null,
      published_at: scheduled ? null : now,
      source_draft_id: draftId,
    };
  });
  try {
    await db.insert("social_posts", rows);
  } catch {
    /* tracking insert failed — the post still went out; surface result anyway */
  }

  return NextResponse.json({ ok: true, result });
}
