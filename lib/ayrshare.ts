/**
 * Ayrshare social-publishing client.
 *
 * One API to publish/schedule posts across LinkedIn, Facebook, Instagram, X,
 * etc. Auth is a single account-level API key (Bearer). For multi-account
 * setups (Ayrshare Business plan) a per-profile `Profile-Key` header selects
 * which connected account to post as — we thread that per tenant.
 *
 * Endpoint + payload verified against https://www.ayrshare.com/docs/apis/post/post
 * The key lives in AYRSHARE_API_KEY (server-only); never expose it to the client.
 */

// Engagement rate is computed with the shared metricool helpers on purpose: a
// second formula here is what made the KPI screen and the monthly report
// disagree before (fixed in c141105). These two helpers are pure and read no env.
import { engagementDenominator, engagementRatePct } from "./metricool";
import { recordVendorUsage } from "./usage-meter";

const AYRSHARE_POST_URL = "https://api.ayrshare.com/api/post";
const AYRSHARE_ANALYTICS_URL = "https://api.ayrshare.com/api/analytics/post";
const AYRSHARE_SOCIAL_ANALYTICS_URL = "https://api.ayrshare.com/api/analytics/social";

/** Platforms Ayrshare accepts in the `platforms` array. */
export const AYRSHARE_PLATFORMS = [
  "bluesky",
  "facebook",
  "gmb",
  "instagram",
  "linkedin",
  "pinterest",
  "reddit",
  "snapchat",
  "telegram",
  "threads",
  "tiktok",
  "twitter",
  "youtube",
] as const;

export type AyrsharePlatform = (typeof AYRSHARE_PLATFORMS)[number];

/** Platforms that CANNOT publish a text-only post — Ayrshare rejects them
 *  without an image or video. Used to block guaranteed failures before we
 *  spend an API call. */
export const MEDIA_REQUIRED_PLATFORMS: readonly AyrsharePlatform[] = [
  "instagram",
  "tiktok",
  "youtube",
  "pinterest",
];

export function requiresMedia(platform: string): boolean {
  return (MEDIA_REQUIRED_PLATFORMS as readonly string[]).includes(platform);
}

export type AyrshareResult = {
  ok: boolean;
  status: "success" | "scheduled" | "error";
  /** Ayrshare's own post id (groups the per-platform results). */
  id?: string;
  scheduleDate?: string;
  postIds?: Array<{ platform: string; id: string; status: string; postUrl?: string }>;
  errors?: Array<{ code?: number; message: string; platform?: string }>;
};

/** Read the account API key. Returns null when Ayrshare isn't configured. */
export function getAyrshareApiKey(): string | null {
  return process.env.AYRSHARE_API_KEY?.trim() || null;
}

/**
 * Map a chosen post format to Ayrshare's per-platform option object. Only Reel and
 * Story need an explicit flag (feed Post, Carousel, and Video are inferred from the
 * media). Confirm the exact Ayrshare option names before enabling in production —
 * this only runs behind the SOCIAL_MULTIFORMAT flag.
 */
export function ayrshareFormatOptions(
  platform: AyrsharePlatform,
  postType?: string | null,
): Record<string, unknown> {
  if (!postType) return {};
  if (platform === "instagram") {
    if (postType === "reel") return { instagramOptions: { reels: true } };
    if (postType === "story") return { instagramOptions: { stories: true } };
  }
  if (platform === "facebook") {
    if (postType === "reel") return { faceBookOptions: { reels: true } };
    if (postType === "story") return { faceBookOptions: { stories: true } };
  }
  return {};
}

export async function postToAyrshare(input: {
  apiKey: string;
  /** Optional per-tenant profile (Ayrshare Business multi-account). */
  profileKey?: string | null;
  post: string;
  platforms: AyrsharePlatform[];
  mediaUrls?: string[];
  /** UTC ISO `YYYY-MM-DDThh:mm:ssZ`; when set, the post is scheduled. */
  scheduleDate?: string;
  /** Auto-split a long post into an X/Twitter thread instead of being rejected
   *  for exceeding 280 chars. */
  twitterThread?: boolean;
  /** Chosen format (reel/story/…) → Ayrshare per-platform option (4A). */
  postType?: string | null;
}): Promise<AyrshareResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
  };
  if (input.profileKey) headers["Profile-Key"] = input.profileKey;

  const body: Record<string, unknown> = {
    post: input.post,
    platforms: input.platforms,
  };
  if (input.mediaUrls && input.mediaUrls.length > 0) body.mediaUrls = input.mediaUrls;
  if (input.scheduleDate) body.scheduleDate = input.scheduleDate;
  // Ayrshare auto-threads a long post across tweets when thread is on.
  if (input.twitterThread && input.platforms.includes("twitter")) {
    body.twitterOptions = { thread: true, threadNumber: false };
  }
  // Per-platform format (Reel/Story). One platform per call here, so [0] applies.
  if (input.postType && input.platforms[0]) {
    Object.assign(body, ayrshareFormatOptions(input.platforms[0], input.postType));
  }

  let data: Record<string, unknown> = {};
  let httpOk = false;
  try {
    const res = await fetch(AYRSHARE_POST_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    httpOk = res.ok;
    data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (e) {
    return {
      ok: false,
      status: "error",
      errors: [{ message: e instanceof Error ? e.message : "Ayrshare request failed" }],
    };
  }

  const status = (data.status as AyrshareResult["status"]) ?? (httpOk ? "success" : "error");
  const result: AyrshareResult = {
    ok: httpOk && status !== "error",
    status,
    id: typeof data.id === "string" ? data.id : undefined,
    scheduleDate: typeof data.scheduleDate === "string" ? data.scheduleDate : undefined,
    postIds: Array.isArray(data.postIds)
      ? (data.postIds as AyrshareResult["postIds"])
      : undefined,
    errors: Array.isArray(data.errors)
      ? (data.errors as AyrshareResult["errors"])
      : undefined,
  };
  // Advisory metering: one billable Ayrshare post per platform, on success.
  if (result.ok) {
    await recordVendorUsage("ayrshare", {
      provider: "ayrshare",
      endpoint: input.scheduleDate ? "post:scheduled" : "post:immediate",
      units: input.platforms.length || 1,
    });
  }
  return result;
}

/**
 * Delete a post from Ayrshare by its post id (deletes scheduled posts before
 * they publish; also removes published posts where the platform allows). Used
 * when the user unschedules or reschedules from the Content Calendar — a
 * reschedule is delete + re-create, since Ayrshare can't edit in place.
 */
export async function deleteAyrsharePost(input: {
  apiKey: string;
  profileKey?: string | null;
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
  };
  if (input.profileKey) headers["Profile-Key"] = input.profileKey;
  try {
    const res = await fetch(AYRSHARE_POST_URL, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ id: input.id }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const ok = res.ok && data.status !== "error";
    return ok
      ? { ok: true }
      : {
          ok: false,
          error:
            (Array.isArray(data.errors) && (data.errors[0] as { message?: string })?.message) ||
            `Ayrshare delete failed (${res.status})`,
        };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Ayrshare delete request failed" };
  }
}

/** Normalized per-platform post metrics. Raw is kept for anything platform-
 *  specific we don't surface yet. */
export type PostMetrics = {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  raw?: unknown;
};

/** Pull the first present numeric field from a set of candidate keys. Ayrshare's
 *  analytics field names differ per network, so we try the common aliases. */
function pickNum(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/** Normalize one platform's raw analytics object into PostMetrics. Field names
 *  are best-effort aliases across networks and should be verified against a live
 *  Ayrshare response for each connected platform. */
export function normalizePostMetrics(raw: Record<string, unknown>): PostMetrics {
  return {
    impressions: pickNum(raw, ["impressions", "impressionCount", "views", "viewCount", "videoViews", "playCount"]),
    reach: pickNum(raw, ["reach", "reachCount", "uniqueImpressions", "accountsReached"]),
    likes: pickNum(raw, ["likeCount", "likes", "favoriteCount", "reactions", "reactionCount"]),
    comments: pickNum(raw, ["commentsCount", "commentCount", "comments", "replies", "replyCount"]),
    shares: pickNum(raw, ["shareCount", "shares", "retweetCount", "reshareCount", "reposts"]),
    clicks: pickNum(raw, ["clickCount", "clicks", "linkClicks", "urlClicks", "websiteClicks"]),
    raw,
  };
}

export type AyrsharePostAnalytics = {
  ok: boolean;
  /** Metrics keyed by platform (e.g. "linkedin"). */
  perPlatform: Record<string, PostMetrics>;
  error?: string;
};

/**
 * Fetch analytics for a published post by its Ayrshare id. Returns per-platform
 * normalized metrics. Ayrshare responds with an object keyed by platform, each
 * carrying an `analytics` block; we normalize whichever fields are present.
 */
export async function getAyrsharePostAnalytics(input: {
  apiKey: string;
  profileKey?: string | null;
  id: string;
  platforms: string[];
}): Promise<AyrsharePostAnalytics> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
  };
  if (input.profileKey) headers["Profile-Key"] = input.profileKey;
  try {
    const res = await fetch(AYRSHARE_ANALYTICS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: input.id, platforms: input.platforms }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.status === "error") {
      return {
        ok: false,
        perPlatform: {},
        error:
          (Array.isArray(data.errors) && (data.errors[0] as { message?: string })?.message) ||
          `Ayrshare analytics failed (${res.status})`,
      };
    }
    const perPlatform: Record<string, PostMetrics> = {};
    for (const platform of input.platforms) {
      const block = data[platform];
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        // Metrics may sit under `analytics` or directly on the platform block.
        const analytics = (b.analytics && typeof b.analytics === "object" ? b.analytics : b) as Record<
          string,
          unknown
        >;
        perPlatform[platform] = normalizePostMetrics(analytics);
      }
    }
    return { ok: true, perPlatform };
  } catch (e) {
    return {
      ok: false,
      perPlatform: {},
      error: e instanceof Error ? e.message : "Ayrshare analytics request failed",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Account-level (profile) analytics — Part 4B                                */
/* -------------------------------------------------------------------------- */

/** Account-wide totals for one connected platform. */
export type AccountMetrics = {
  followers?: number;
  /** Unique people reached. LinkedIn reports uniqueImpressions; FB reports neither. */
  reach?: number;
  impressions?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  /** Lifetime post/video count where the platform reports it. */
  posts?: number;
  /** interactions ÷ denominator × 100, via the shared metricool helpers. */
  engagementRatePct?: number;
  /** Ayrshare warnings for this platform (e.g. code 395, demographics withheld). */
  warnings?: Array<{ code?: number; message: string }>;
  raw?: unknown;
};

/**
 * Ayrshare returns -1 for a metric the platform declined to compute (seen on
 * TikTok's commentCountTotal). Untrapped it becomes a negative interaction count
 * and drags the engagement rate below zero.
 */
function positive(n: number | undefined): number | undefined {
  return typeof n === "number" && n >= 0 ? n : undefined;
}

/**
 * Map one platform's account analytics onto AccountMetrics.
 *
 * Field names are NOT aliased/guessed here the way normalizePostMetrics does it:
 * they were read off a live /api/analytics/social response (2026-08-15, all four
 * connected networks) and genuinely differ per platform — Instagram's reachCount,
 * LinkedIn's uniqueImpressionsCount and Facebook's pageMediaView are the same
 * idea under three names. Re-verify against a live response before adding a
 * platform.
 */
export function normalizeAccountMetrics(platform: string, raw: Record<string, unknown>): AccountMetrics {
  const n = (...keys: string[]) => positive(pickNum(raw, keys));
  const base: AccountMetrics = { raw };

  if (platform === "instagram") {
    Object.assign(base, {
      followers: n("followersCount"),
      reach: n("reachCount"),
      views: n("viewsCount"),
      likes: n("likeCount"),
      comments: n("commentsCount"),
      shares: n("shareCount"),
      posts: n("mediaCount"),
    });
  } else if (platform === "facebook") {
    // No reach metric on the Page object; pageMediaView is the closest
    // impressions-style figure. pagePostEngagements is Facebook's own
    // interaction total and is kept in raw rather than used as likes.
    const reactions = raw.reactions as Record<string, unknown> | undefined;
    Object.assign(base, {
      followers: n("followersCount", "fanCount", "pageFollows"),
      impressions: n("pageMediaView"),
      views: n("pageVideoViews"),
      likes: positive(reactions ? pickNum(reactions, ["total"]) : undefined),
      posts: undefined,
    });
  } else if (platform === "linkedin") {
    const followers = raw.followers as Record<string, unknown> | undefined;
    Object.assign(base, {
      followers: positive(followers ? pickNum(followers, ["totalFollowerCount", "organicFollowerCount"]) : undefined),
      impressions: n("impressionCount"),
      reach: n("uniqueImpressionsCount"),
      likes: n("likeCount"),
      comments: n("commentCount"),
      shares: n("shareCount"),
      clicks: n("clickCount"),
    });
  } else if (platform === "tiktok") {
    Object.assign(base, {
      followers: n("followerCount"),
      views: n("viewCountTotal"),
      likes: n("likeCountTotal"),
      comments: n("commentCountTotal"),
      shares: n("shareCountTotal"),
      posts: n("videoCountTotal"),
      clicks: n("profileViews"),
    });
  }

  // One engagement formula across the app. LinkedIn also reports its own
  // `engagement` field, but that one counts clicks as interactions (verified:
  // (likes+comments+shares+clicks) ÷ impressions reproduces it exactly), which
  // would disagree with the KPI pipeline and the monthly report. Keep ours;
  // theirs stays available in raw.
  const interactions = (base.likes ?? 0) + (base.comments ?? 0) + (base.shares ?? 0);
  const denominator = engagementDenominator(platform, base.reach ?? 0, base.impressions ?? base.views ?? 0);
  base.engagementRatePct = engagementRatePct(interactions, denominator);

  return base;
}

export type AyrshareAccountAnalytics = {
  ok: boolean;
  perPlatform: Record<string, AccountMetrics>;
  /** ISO timestamp Ayrshare last refreshed its cache, per platform. */
  lastUpdated: Record<string, string>;
  error?: string;
};

/**
 * Fetch account-level analytics for the connected profiles.
 *
 * NOTE ON DEMOGRAPHICS: this endpoint does NOT reliably return audience
 * age/gender/city/country. Meta withholds a breakdown until it holds 100+ people
 * (Ayrshare surfaces this as warning code 395) and TikTok returns empty audience
 * arrays below its own threshold. The monthly report's Sections 5-6 therefore
 * stay manually maintained; the warnings are passed through so the UI can say
 * why rather than showing an unexplained blank.
 */
export async function getAyrshareSocialAnalytics(input: {
  apiKey: string;
  profileKey?: string | null;
  platforms: string[];
}): Promise<AyrshareAccountAnalytics> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
  };
  if (input.profileKey) headers["Profile-Key"] = input.profileKey;

  try {
    const res = await fetch(AYRSHARE_SOCIAL_ANALYTICS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ platforms: input.platforms }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.status === "error") {
      return {
        ok: false,
        perPlatform: {},
        lastUpdated: {},
        error:
          (Array.isArray(data.errors) && (data.errors[0] as { message?: string })?.message) ||
          `Ayrshare account analytics failed (${res.status})`,
      };
    }

    const perPlatform: Record<string, AccountMetrics> = {};
    const lastUpdated: Record<string, string> = {};
    for (const platform of input.platforms) {
      const block = data[platform];
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      const analytics = (b.analytics && typeof b.analytics === "object" ? b.analytics : b) as Record<
        string,
        unknown
      >;
      const metrics = normalizeAccountMetrics(platform, analytics);
      if (Array.isArray(b.warning)) {
        metrics.warnings = (b.warning as Array<Record<string, unknown>>)
          .map((w) => ({ code: typeof w.code === "number" ? w.code : undefined, message: String(w.message ?? "") }))
          .filter((w) => w.message);
      }
      perPlatform[platform] = metrics;
      if (typeof b.lastUpdated === "string") lastUpdated[platform] = b.lastUpdated;
    }
    return { ok: true, perPlatform, lastUpdated };
  } catch (e) {
    return {
      ok: false,
      perPlatform: {},
      lastUpdated: {},
      error: e instanceof Error ? e.message : "Ayrshare account analytics request failed",
    };
  }
}
