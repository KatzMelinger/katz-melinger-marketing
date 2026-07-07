/**
 * Page-optimizer helpers — the matching + classification logic behind the
 * Content Production "Repurpose" tab (update an already-published page).
 *
 * For each published page in the site inventory (site_pages) we:
 *   - classify its keyword cluster + intent (commercial vs informational), and
 *   - match it to "missing keyword" opportunities (seo_opportunities) so the
 *     reviewer can see which keywords this page could pick up in an update.
 *
 * Match signal (chosen with Diana): the opportunity shares the page's keyword
 * CLUSTER and its PILLAR (or, failing a pillar on either side, its practice
 * area). Cluster alone is too broad; cluster + pillar/practice keeps it tight.
 *
 * Pure functions only (no DB / network) so they're trivial to unit-test and
 * reuse from both the read API and the update-draft generator. The live-page
 * fetch is the one impure helper, kept here because it's optimizer-specific.
 */

import { classifyKeywordCluster, type KeywordCluster } from "@/lib/keyword-cluster";

export type PageIntent = "commercial" | "informational";

export type PageLike = {
  title: string | null;
  h1: string | null;
  topics: string[] | null;
  pillar: string | null;
  practice_area: string | null;
  page_type?: string | null;
};

export type OppLike = {
  id: string;
  keyword: string;
  pillar_id: string | null;
  practice_area: string | null;
  intent: string | null;
  search_volume: number | null;
  recommended_content_type: string | null;
};

/** The text we run the cluster classifier over for a page. */
export function pageKeywordText(page: PageLike): string {
  return [page.title, page.h1, ...(page.topics ?? [])].filter(Boolean).join(" ");
}

export function pageCluster(page: PageLike): KeywordCluster {
  return classifyKeywordCluster(pageKeywordText(page));
}

// Pages built to convert (service / practice-area / pillar hubs) read as
// commercial intent; everything else (blog, cluster, case result) is content.
const COMMERCIAL_PAGE_TYPES = new Set(["service_page", "practice_area", "pillar"]);

export function pageIntent(pageType: string | null | undefined): PageIntent {
  return pageType && COMMERCIAL_PAGE_TYPES.has(pageType)
    ? "commercial"
    : "informational";
}

/**
 * Opportunities that match this page: same keyword cluster AND (same pillar OR,
 * if a pillar isn't set on both sides, same practice area). Returns the matched
 * opportunities untouched so the caller can shape the payload.
 */
export function matchOpportunitiesToPage<T extends OppLike>(
  page: PageLike,
  opportunities: T[],
): T[] {
  const pc = pageCluster(page).key;
  if (pc === "other") return [];
  return opportunities.filter((o) => {
    if (classifyKeywordCluster(o.keyword).key !== pc) return false;
    const samePillar = !!page.pillar && !!o.pillar_id && o.pillar_id === page.pillar;
    const samePractice =
      !!page.practice_area && !!o.practice_area && o.practice_area === page.practice_area;
    return samePillar || samePractice;
  });
}

const FETCH_UA =
  "Mozilla/5.0 (compatible; MarketingDashboardPageOptimizer/0.1)";

/**
 * Fetch a published page and return the main-body HTML (chrome stripped,
 * <main>/<article> preferred). Shared by fetchPageText and fetchPageOutline.
 * Throws on a non-OK response so callers can surface "couldn't read the page".
 */
async function fetchTargetHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": FETCH_UA, Accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Could not fetch the page (HTTP ${res.status}).`);
  let html = (await res.text()).slice(0, 400_000);
  // Drop chrome that isn't the article body.
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  // Prefer <main> / <article> when present.
  const main = html.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i);
  return main ? main[2] : html;
}

function stripToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch a published page and return its main text content (tags stripped,
 * whitespace collapsed, capped). Used to ground the update-draft generator in
 * what's actually live today.
 */
export async function fetchPageText(url: string): Promise<string> {
  const target = await fetchTargetHtml(url);
  return stripToText(target).slice(0, 12_000);
}

export type PageOutline = {
  /** Main-body plain text (as fetchPageText). */
  text: string;
  /** The page's heading outline, in document order. */
  headings: { level: number; text: string }[];
};

/**
 * Like fetchPageText, but also returns the heading outline (h1–h6). The Redraft
 * Gap Audit uses the outline to tell which expected sections a page is missing.
 */
export async function fetchPageOutline(url: string): Promise<PageOutline> {
  const target = await fetchTargetHtml(url);
  const headings: { level: number; text: string }[] = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(target)) !== null) {
    const text = stripToText(m[2]);
    if (text) headings.push({ level: Number(m[1]), text: text.slice(0, 160) });
  }
  return { text: stripToText(target).slice(0, 12_000), headings };
}
