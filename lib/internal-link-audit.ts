/**
 * Internal-link audit.
 *
 * Crawls up to N pages from the domain's sitemap (or homepage), records every
 * outbound internal link from each page, and computes:
 *   - inbound link count per page
 *   - orphans: crawled pages with zero inbound links from the rest of the set
 *   - thin pages: < 3 outbound internal links
 *   - hubs: top pages by inbound link count
 *
 * The shape mirrors the AI crawler's site-walk so we can swap in its sitemap
 * resolver. Snapshots persist to internal_link_audits.
 */

import { logger } from "./logger";
import { getSupabaseAdmin } from "./supabase-server";

const USER_AGENT = "KMDashboard-LinkAuditor/1.0";
const MAX_PAGES = 30;

type CrawlNode = {
  url: string;
  outboundInternal: Set<string>; // normalized targets
};

function normalize(url: string, host: string): string | null {
  try {
    const u = new URL(url);
    if (!u.host.includes(host)) return null;
    u.hash = "";
    // Trim trailing slash for consistent matching, but keep root.
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

function extractAnchorHrefs(html: string, base: string, host: string): Set<string> {
  const out = new Set<string>();
  const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const href = m[1].trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      continue;
    }
    let absolute: string;
    try {
      absolute = new URL(href, base).toString();
    } catch {
      continue;
    }
    const normalized = normalize(absolute, host);
    if (normalized) out.add(normalized);
  }
  return out;
}

async function fetchPageHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    logger.warn(
      { url, error: err instanceof Error ? err.message : String(err) },
      "Link audit fetch failed",
    );
    return null;
  }
}

/**
 * Resolve a sitemap to a flat list of page URLs.
 *
 * Handles sitemap-index files (WordPress + Yoast SEO ship one of these by
 * default — sitemap.xml points to post-sitemap.xml, page-sitemap.xml, etc.).
 * Before this, the audit treated every <loc> as a page URL, so it would
 * "crawl" 6 sub-sitemap XML files that contain zero anchor tags and report
 * 0 internal links.
 *
 * Strategy:
 *   - Detect <sitemapindex> wrapper OR <loc>s that look like .xml sitemaps
 *   - Recursively fetch sub-sitemaps (depth-limited, visited-tracked)
 *   - Filter out anything that still looks like a sitemap before returning
 */
async function resolveSeedUrls(base: string, host: string): Promise<string[]> {
  const MAX_DEPTH = 3;
  const visited = new Set<string>();
  const pages = new Set<string>();

  async function fetchAndExpand(sitemapUrl: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    if (visited.has(sitemapUrl)) return;
    visited.add(sitemapUrl);

    let xml = "";
    try {
      const res = await fetch(sitemapUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (!res.ok) return;
      xml = await res.text();
    } catch {
      return;
    }

    const isIndex = /<sitemapindex\b/i.test(xml);
    const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    const subSitemaps: string[] = [];
    while ((m = re.exec(xml)) !== null) {
      const u = m[1].trim();
      if (!u) continue;
      // Anything that still looks like a sitemap (.xml, .xml.gz) is a
      // sub-sitemap to expand, not a page to crawl.
      if (isIndex || /\.xml(\.gz)?(\?|$)/i.test(u)) {
        subSitemaps.push(u);
      } else {
        const n = normalize(u, host);
        if (n) pages.add(n);
      }
    }

    // Recurse into sub-sitemaps after collecting them, so a sitemap that
    // mixes pages + sub-references still works.
    for (const sub of subSitemaps) {
      await fetchAndExpand(sub, depth + 1);
    }
  }

  await fetchAndExpand(`${base}/sitemap.xml`, 0);

  if (pages.size > 0) return Array.from(pages);
  return [base];
}

export type LinkAuditResult = {
  domain: string;
  pages: number;
  totalInternalLinks: number;
  totalExternalLinks: number;
  orphans: { url: string }[];
  thinPages: { url: string; outbound: number }[];
  hubs: { url: string; inbound: number }[];
  graph: { url: string; inbound: number; outbound: number }[];
  snapshotId: string;
};

export async function runInternalLinkAudit(input: string): Promise<LinkAuditResult> {
  let raw = (input || "").trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const u = new URL(raw);
  const base = `${u.protocol}//${u.host}`;
  const host = u.host.replace(/^www\./, "");

  const seeds = await resolveSeedUrls(base, host);
  const targets = Array.from(new Set(seeds)).slice(0, MAX_PAGES);

  const nodes: CrawlNode[] = [];
  let externalLinks = 0;

  for (const url of targets) {
    const html = await fetchPageHtml(url);
    if (!html) continue;
    const internal = extractAnchorHrefs(html, url, host);
    nodes.push({ url, outboundInternal: internal });

    // Count external links — quick anchor scan, separate from the internal set.
    const aRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = aRegex.exec(html)) !== null) {
      const href = m[1];
      if (!href || href.startsWith("#") || href.startsWith("/")) continue;
      if (href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      try {
        const linked = new URL(href, url);
        if (!linked.host.includes(host)) externalLinks++;
      } catch {
        /* ignore */
      }
    }
  }

  // Build inbound counts. Only count an inbound link if the target is itself a
  // crawled page — that way "orphans" means "crawled pages no other crawled
  // page links to," which is the meaningful definition.
  const crawledSet = new Set(nodes.map((n) => n.url));
  const inboundMap = new Map<string, number>();
  for (const n of nodes) inboundMap.set(n.url, 0);
  let totalInternal = 0;
  for (const n of nodes) {
    for (const target of n.outboundInternal) {
      totalInternal++;
      if (crawledSet.has(target) && target !== n.url) {
        inboundMap.set(target, (inboundMap.get(target) ?? 0) + 1);
      }
    }
  }

  const graph = nodes
    .map((n) => ({
      url: n.url,
      inbound: inboundMap.get(n.url) ?? 0,
      outbound: Array.from(n.outboundInternal).filter((u) => crawledSet.has(u) && u !== n.url).length,
    }))
    .sort((a, b) => b.inbound - a.inbound);

  const orphans = graph.filter((g) => g.inbound === 0 && g.url !== base).map((g) => ({ url: g.url }));
  const thinPages = graph.filter((g) => g.outbound < 3).map((g) => ({ url: g.url, outbound: g.outbound }));
  const hubs = graph.slice(0, 10).map((g) => ({ url: g.url, inbound: g.inbound }));

  const supabase = getSupabaseAdmin();
  const { data: snapshot, error } = await supabase
    .from("internal_link_audits")
    .insert({
      domain: host,
      pages: nodes.length,
      total_internal_links: totalInternal,
      total_external_links: externalLinks,
      orphan_pages: orphans,
      thin_pages: thinPages,
      hub_pages: hubs,
      page_graph: graph,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to save audit: ${error.message}`);

  return {
    domain: host,
    pages: nodes.length,
    totalInternalLinks: totalInternal,
    totalExternalLinks: externalLinks,
    orphans,
    thinPages,
    hubs,
    graph,
    snapshotId: snapshot.id,
  };
}
