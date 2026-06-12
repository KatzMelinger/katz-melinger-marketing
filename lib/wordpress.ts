/**
 * WordPress REST API helpers (public /wp-json endpoints).
 *
 * Gives the cannibalization step two things the sitemap can't: a published-URL
 * inventory even when the sitemap isn't public (intelligence-layer Blocker 1),
 * and each page/post's last-modified time — which is what separates "Optimize"
 * (ranks poorly) from "Update" (ranks fine but content is stale, >6mo).
 *
 * Everything degrades to an empty result on any failure, so a site that blocks
 * /wp-json simply yields no content-age signal (labels then rely on rank).
 */

const WP_UA = "Mozilla/5.0 (compatible; KMDashboard/1.0)";

function baseFromDomain(domain: string): string {
  const d = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `https://${d}`;
}

/**
 * Normalize a URL for cross-source matching (WordPress link vs. GSC page vs.
 * stored existing_url): lowercase host without `www.`, path without a trailing
 * slash, no scheme / query / hash.
 */
export function normalizeUrlForMatch(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.host.replace(/^www\./, "").toLowerCase();
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    return `${host}${path}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

type WpItem = { link?: string; modified_gmt?: string };

async function fetchType(base: string, type: "pages" | "posts"): Promise<WpItem[]> {
  const out: WpItem[] = [];
  // WP caps per_page at 100; paginate until X-WP-TotalPages (hard cap 20 pages
  // = 2000 items so a huge blog can't stall the sync).
  for (let page = 1; page <= 20; page++) {
    let res: Response;
    try {
      res = await fetch(
        `${base}/wp-json/wp/v2/${type}?per_page=100&page=${page}&status=publish&_fields=link,modified_gmt`,
        { headers: { "User-Agent": WP_UA }, signal: AbortSignal.timeout(15_000) },
      );
    } catch {
      break;
    }
    if (!res.ok) break;
    let batch: WpItem[];
    try {
      batch = (await res.json()) as WpItem[];
    } catch {
      break;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    const totalPages = Number(res.headers.get("x-wp-totalpages") ?? "1");
    if (!Number.isFinite(totalPages) || page >= totalPages) break;
  }
  return out;
}

/**
 * Map of normalized-URL → last-modified ISO timestamp for every published page
 * and post. Empty map if /wp-json is unreachable.
 */
export async function fetchWordPressModifiedMap(domain: string): Promise<Map<string, string>> {
  const base = baseFromDomain(domain);
  const map = new Map<string, string>();
  const [pages, posts] = await Promise.all([
    fetchType(base, "pages"),
    fetchType(base, "posts"),
  ]);
  for (const it of [...pages, ...posts]) {
    if (!it.link || !it.modified_gmt) continue;
    // modified_gmt is UTC with no zone suffix — append Z so Date parses it as UTC.
    const iso = /[zZ]$/.test(it.modified_gmt) ? it.modified_gmt : `${it.modified_gmt}Z`;
    map.set(normalizeUrlForMatch(it.link), iso);
  }
  return map;
}
