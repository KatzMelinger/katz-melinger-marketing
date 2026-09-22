/**
 * Link, UTM, and platform mechanics for social posts (spec 6.14's last bullet).
 *
 * Three separate problems, deliberately kept in one small module since they
 * all fire off the same "find the URLs in this body" pass:
 *   - an inherited tracking param (utm_source=chatgpt.com from a pasted
 *     ChatGPT link, or a stray gclid/fbclid) must never carry through to a
 *     published post — it attributes the click to the wrong source and can
 *     leak an internal referral chain into public copy;
 *   - every link that DOES go out should carry the firm's OWN utm_source per
 *     channel, so paid/organic attribution in GA4 actually works;
 *   - a link that 404s wasn't worth flagging on the caption at all — this is
 *     checked live, right before scheduling, not assumed from the URL shape.
 *
 * Instagram's "don't put a raw link in the caption at all" rule already
 * exists (lib/social-compliance.ts's instagram_link_cta check) and isn't
 * duplicated here — sanitizing a URL Instagram shouldn't have anyway would
 * just make the wrong thing look tidier.
 */

const URL_RE = /https?:\/\/[^\s)"'<>]+/gi;

const TRACKING_PARAM_RE = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_[a-z]+|_hs[a-z]*)$/i;

/** Ayrshare/network key -> the utm_source value the firm's own attribution
 *  should carry, distinct from whatever the URL arrived with. */
const UTM_SOURCE_BY_PLATFORM: Record<string, string> = {
  linkedin: "linkedin",
  facebook: "facebook",
  instagram: "instagram",
  gmb: "gbp",
  tiktok: "tiktok",
  video_short: "tiktok",
  twitter: "twitter",
  threads: "threads",
  pinterest: "pinterest",
  youtube: "youtube",
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Strip every inherited tracking param and set the firm's own social UTM.
 *  Non-http(s) input, or a URL that fails to parse, is returned unchanged —
 *  this rewrites tracking params, it doesn't validate the link. */
export function retagSocialUrl(rawUrl: string, platform: string, campaign?: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM_RE.test(key)) u.searchParams.delete(key);
  }
  const source = UTM_SOURCE_BY_PLATFORM[platform] ?? platform;
  u.searchParams.set("utm_source", source);
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", campaign ? slugify(campaign) : "social");
  return u.toString();
}

/** Replace every http(s) URL in the body with its retagged form. Returns the
 *  original body untouched (same string, `changed: false`) when there's
 *  nothing to do — callers use `changed` to skip a write. */
export function sanitizeLinksForPlatform(
  body: string,
  platform: string,
  campaign?: string,
): { body: string; changed: boolean; urls: string[] } {
  const urls: string[] = [];
  let changed = false;
  const next = body.replace(URL_RE, (match) => {
    const retagged = retagSocialUrl(match, platform, campaign);
    urls.push(retagged);
    if (retagged !== match) changed = true;
    return retagged;
  });
  return { body: next, changed, urls };
}

/** LinkedIn and Facebook render a caption link fine, but a link posted as
 *  the FIRST COMMENT rather than in the caption itself avoids the algorithmic
 *  reach penalty both platforms apply to outbound links in the post body —
 *  spec 6.14's "recommend the link in the first comment" bullet. Advisory
 *  only: this app has no first-comment posting path today, so it's guidance
 *  attached to the draft, the same non-blocking pattern source-currency (S13d)
 *  already uses, not a gate. */
export function recommendsFirstComment(body: string, platform: string): boolean {
  return (platform === "linkedin" || platform === "facebook") && URL_RE.test(body);
}

export type LinkCheckResult = { url: string; ok: boolean; status?: number; error?: string };

/** Does this URL actually resolve? HEAD first (cheap), falling back to GET —
 *  some servers (WordPress among them) reject HEAD with a 405 for a page
 *  that GETs fine. A redirect chain ending in 200 counts as resolving;
 *  fetch() follows redirects by default. */
async function checkOne(url: string): Promise<LinkCheckResult> {
  const attempt = async (method: "HEAD" | "GET"): Promise<Response> =>
    fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(10_000) });
  try {
    let res = await attempt("HEAD");
    if (res.status === 405 || res.status === 501) res = await attempt("GET");
    return { url, ok: res.ok, status: res.status };
  } catch (e) {
    return { url, ok: false, error: e instanceof Error ? e.message : "unreachable" };
  }
}

/** Check every distinct URL in the body resolves. Best-effort and bounded —
 *  a post realistically carries one link, but this holds even if several. */
export async function checkLinksResolve(body: string): Promise<LinkCheckResult[]> {
  const urls = [...new Set(body.match(URL_RE) ?? [])].slice(0, 5);
  if (urls.length === 0) return [];
  return Promise.all(urls.map(checkOne));
}
