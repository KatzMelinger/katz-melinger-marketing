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

/** An Ayrshare account key: four 8-character alphanumeric groups. Advisory. */
const AYRSHARE_KEY_SHAPE = /^[A-Za-z0-9]{8}(-[A-Za-z0-9]{8}){3}$/;

/**
 * Characters an HTTP header value may legally carry — printable ASCII, no
 * spaces or control characters. A pasted code snippet (braces, quotes,
 * newlines) fails this, which is the incident this guards against: AYRSHARE_API_KEY
 * once held an entire Ayrshare docs example, so fetch() threw while building the
 * header, and the thrown message — which quotes the offending value back — carried
 * the live token into the API response and on into social_posts.last_error.
 */
const HEADER_SAFE = /^[\x21-\x7E]+$/;

/**
 * Why this key can't be sent, or null when it's usable. Deliberately two-tier:
 * header-safety is a hard reject because the request provably cannot succeed,
 * while a shape mismatch alone is not, so a future change to Ayrshare's key
 * format can't take publishing down on our side.
 */
export function ayrshareKeyProblem(key: string | null | undefined): string | null {
  const k = (key ?? "").trim();
  if (!k) return "Ayrshare API key is not set.";
  if (!HEADER_SAFE.test(k)) {
    return (
      "Ayrshare API key is not a valid token — it contains spaces, line breaks, or " +
      "other characters an HTTP header cannot carry. Store only the key itself: " +
      'four 8-character groups, with no "Bearer" prefix and no surrounding code.'
    );
  }
  if (k.length > 200) {
    return "Ayrshare API key is implausibly long — store only the key itself, not a code sample.";
  }
  return null;
}

/** Whether the key matches Ayrshare's documented shape. Advisory, not a gate. */
export function looksLikeAyrshareKey(key: string): boolean {
  return AYRSHARE_KEY_SHAPE.test(key.trim());
}

/**
 * Strip anything credential-shaped from a vendor message before it can reach a
 * client, a database column, or a log line. Three overlapping nets — the live
 * key by exact value, any Bearer run, and any token-shaped substring — so a
 * stale key still sitting in a queued message gets scrubbed too.
 */
export function redactCredentials(text: string, apiKey?: string | null): string {
  const key = (apiKey ?? "").trim();
  let out = text;
  if (key.length >= 8) out = out.split(key).join("[redacted]");
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  out = out.replace(/[A-Za-z0-9]{8}(-[A-Za-z0-9]{8}){3}/g, "[redacted]");
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

/**
 * Turn a thrown error into a message that is safe to hand back. The raw text is
 * redacted before it is logged rather than logged verbatim: nothing about a bad
 * key is easier to debug with the key echoed back, so a "raw error, server-side
 * only" log line would just be a slower leak.
 */
function safeVendorError(e: unknown, apiKey: string | null | undefined, fallback: string): string {
  if (!(e instanceof Error)) return fallback;
  const message = redactCredentials(e.message, apiKey);
  console.error("[ayrshare] request failed:", message);
  return message || fallback;
}

/**
 * Extra fields a format needs beyond the post text. Google Business event and
 * offer posts carry their own title and run dates; everything else ignores this.
 */
export type FormatExtras = {
  title?: string | null;
  /** ISO 8601, e.g. 2026-09-01T14:00:00.000Z */
  startDate?: string | null;
  endDate?: string | null;
  couponCode?: string | null;
  redeemOnlineUrl?: string | null;
  termsConditions?: string | null;
};

/**
 * Fields Google Business requires per format. A gmbOptions.event or .offer
 * object without these is rejected by Ayrshare, so we check before spending the
 * call — same reasoning as MEDIA_REQUIRED_PLATFORMS.
 */
const GMB_REQUIRED: Record<string, Array<keyof FormatExtras>> = {
  event: ["title", "startDate", "endDate"],
  offer: ["title", "startDate", "endDate"],
};

/**
 * Why a format can't be sent yet, or null when it's good to go. Returning a
 * reason rather than silently degrading matters here: before this, selecting
 * Offer or Event on Google Business produced an empty option object and the post
 * went out as a plain what's-new, with nothing in the UI to say the chosen
 * format had been dropped.
 */
export function formatOptionsError(
  platform: AyrsharePlatform,
  postType?: string | null,
  extras?: FormatExtras,
): string | null {
  if (!postType || platform !== "gmb") return null;
  const required = GMB_REQUIRED[postType];
  if (!required) return null;
  const missing = required.filter((k) => !String(extras?.[k] ?? "").trim());
  if (missing.length === 0) return null;
  return `Google Business ${postType} posts need ${missing.join(", ")}.`;
}

/**
 * Map a chosen post format to Ayrshare's per-platform option object. Only Reel and
 * Story need an explicit flag on Meta (feed Post, Carousel, and Video are inferred
 * from the media); Google Business needs a full nested object per type.
 *
 * gmbOptions shapes verified against
 * https://www.ayrshare.com/docs/rest-api/endpoints/post/google-business-profile
 * Runs behind the SOCIAL_MULTIFORMAT flag.
 */
export function ayrshareFormatOptions(
  platform: AyrsharePlatform,
  postType?: string | null,
  extras?: FormatExtras,
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
  if (platform === "gmb") {
    // A what's-new post is Google's default; it needs no options object at all.
    if (postType === "whats_new") return {};
    if (formatOptionsError(platform, postType, extras)) return {};
    const window = {
      title: extras?.title ?? "",
      startDate: extras?.startDate ?? "",
      endDate: extras?.endDate ?? "",
    };
    if (postType === "event") return { gmbOptions: { event: window } };
    if (postType === "offer") {
      // Google drops empty optional fields rather than erroring, but sending
      // them empty shows blank rows on the offer card, so omit what's unset.
      const offer: Record<string, unknown> = { ...window };
      if (extras?.couponCode?.trim()) offer.couponCode = extras.couponCode.trim();
      if (extras?.redeemOnlineUrl?.trim()) offer.redeemOnlineUrl = extras.redeemOnlineUrl.trim();
      if (extras?.termsConditions?.trim()) offer.termsConditions = extras.termsConditions.trim();
      return { gmbOptions: { offer } };
    }
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
  /** Title/dates a Google Business event or offer needs (4A). */
  formatExtras?: FormatExtras;
}): Promise<AyrshareResult> {
  // Refuse a key that can't be a header value rather than letting fetch() throw
  // with the bad value quoted back at us.
  const keyProblem = ayrshareKeyProblem(input.apiKey);
  if (keyProblem) return { ok: false, status: "error", errors: [{ message: keyProblem }] };

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
  // Per-platform format (Reel/Story/GBP type). One platform per call here, so [0] applies.
  if (input.postType && input.platforms[0]) {
    // Fail a format we can't build rather than posting it as something else —
    // an offer silently downgraded to a plain update is worse than a refusal.
    const invalid = formatOptionsError(input.platforms[0], input.postType, input.formatExtras);
    if (invalid) return { ok: false, status: "error", errors: [{ message: invalid }] };
    Object.assign(body, ayrshareFormatOptions(input.platforms[0], input.postType, input.formatExtras));
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
      errors: [{ message: safeVendorError(e, input.apiKey, "Ayrshare request failed") }],
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
  const keyProblem = ayrshareKeyProblem(input.apiKey);
  if (keyProblem) return { ok: false, error: keyProblem };

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
          error: redactCredentials(
            (Array.isArray(data.errors) && (data.errors[0] as { message?: string })?.message) ||
              `Ayrshare delete failed (${res.status})`,
            input.apiKey,
          ),
        };
  } catch (e) {
    return { ok: false, error: safeVendorError(e, input.apiKey, "Ayrshare delete request failed") };
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
  const keyProblem = ayrshareKeyProblem(input.apiKey);
  if (keyProblem) return { ok: false, perPlatform: {}, error: keyProblem };

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
        error: redactCredentials(
          (Array.isArray(data.errors) && (data.errors[0] as { message?: string })?.message) ||
            `Ayrshare analytics failed (${res.status})`,
          input.apiKey,
        ),
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
      error: safeVendorError(e, input.apiKey, "Ayrshare analytics request failed"),
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
  const keyProblem = ayrshareKeyProblem(input.apiKey);
  if (keyProblem) return { ok: false, perPlatform: {}, lastUpdated: {}, error: keyProblem };

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
        error: redactCredentials(
          (Array.isArray(data.errors) && (data.errors[0] as { message?: string })?.message) ||
            `Ayrshare account analytics failed (${res.status})`,
          input.apiKey,
        ),
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
      error: safeVendorError(e, input.apiKey, "Ayrshare account analytics request failed"),
    };
  }
}
