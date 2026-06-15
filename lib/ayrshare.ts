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

import { recordVendorUsage } from "./usage-meter";

const AYRSHARE_POST_URL = "https://api.ayrshare.com/api/post";

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

export async function postToAyrshare(input: {
  apiKey: string;
  /** Optional per-tenant profile (Ayrshare Business multi-account). */
  profileKey?: string | null;
  post: string;
  platforms: AyrsharePlatform[];
  mediaUrls?: string[];
  /** UTC ISO `YYYY-MM-DDThh:mm:ssZ`; when set, the post is scheduled. */
  scheduleDate?: string;
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
