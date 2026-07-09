/**
 * Outbound link analysis + Claude-generated link-building strategy.
 *
 * Different from /seo/backlinks (which shows the DataForSEO incoming backlink
 * profile — sites that already link to katzmelinger.com). This feature:
 *
 *   1. Crawls the firm's own sitemap and extracts every external link the
 *      site already points OUT to (good signal for who they could request
 *      reciprocal links from).
 *   2. Pulls existing DataForSEO competitor + authority data so Claude knows
 *      what kind of authority profile to aim for.
 *   3. Asks Claude for a structured outreach plan: categories of targets,
 *      specific organizations to pitch, outreach templates, expected
 *      difficulty + impact, plus a 3-month action plan.
 *
 * SSRF-safe: only katzmelinger.com URLs are crawled; the verifier function
 * blocks private IPs / localhost / metadata endpoints.
 */

import { logger } from "./logger";
import { getTenantConfig } from "./tenant-config";

const USER_AGENT = "MarketingDashboard-BacklinkAnalyzer/1.0";
const MAX_PAGES_TO_SCAN = 15;

export type ExternalLink = {
  url: string;
  anchorText: string;
  sourcePage: string;
};

export type BacklinkProfile = {
  domain: string;
  sitePages: string[];
  externalLinksOut: ExternalLink[];
  internalLinkCount: number;
  externalLinkCount: number;
  scannedAt: string;
};

const SOCIAL_DOMAINS = new Set([
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "maps.google.com",
  "goo.gl",
  "google.com",
  "youtu.be",
]);

function getHostname(href: string): string | null {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isOurDomain(hostname: string, ourDomain: string): boolean {
  return hostname === ourDomain || hostname.endsWith(`.${ourDomain}`);
}

function isSocialDomain(hostname: string): boolean {
  return SOCIAL_DOMAINS.has(hostname);
}

function extractExternalLinks(html: string, sourceUrl: string, ourDomain: string): ExternalLink[] {
  const regex = /<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links: ExternalLink[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = regex.exec(html)) !== null) {
    const url = m[1];
    const anchorText = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const hostname = getHostname(url);
    if (!hostname) continue;
    if (isOurDomain(hostname, ourDomain)) continue;
    if (isSocialDomain(hostname)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ url, anchorText: anchorText || url, sourcePage: sourceUrl });
  }
  return links;
}

function extractAllHrefs(html: string, ourDomain: string): { internal: number; external: number } {
  const regex = /href=["']([^"']+)["']/gi;
  let internal = 0;
  let external = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const href = m[1];
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    if (href.startsWith("/")) {
      internal++;
    } else if (href.startsWith("http")) {
      const hostname = getHostname(href);
      if (hostname && isOurDomain(hostname, ourDomain)) internal++;
      else external++;
    }
  }
  return { internal, external };
}

export async function analyzeOutboundLinkProfile(): Promise<BacklinkProfile> {
  // Per-tenant: crawl the signed-in firm's own site, not a hardcoded domain.
  const ourDomain = (await getTenantConfig()).seoDomain;
  const baseUrl = `https://www.${ourDomain}`;
  let sitePages: string[] = [];

  try {
    const res = await fetch(`${baseUrl}/sitemap.xml`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const xml = await res.text();
      const urlRegex = /<loc>(.*?)<\/loc>/g;
      let m: RegExpExecArray | null;
      while ((m = urlRegex.exec(xml)) !== null) sitePages.push(m[1]);
    }
  } catch {
    logger.warn({}, "Sitemap fetch failed; falling back to homepage");
  }

  if (sitePages.length === 0) sitePages = [baseUrl];

  const targets = sitePages.slice(0, MAX_PAGES_TO_SCAN);
  const externalLinks: ExternalLink[] = [];
  let internalCount = 0;
  let externalCount = 0;

  for (const url of targets) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      externalLinks.push(...extractExternalLinks(html, url, ourDomain));
      const counts = extractAllHrefs(html, ourDomain);
      internalCount += counts.internal;
      externalCount += counts.external;
    } catch (err) {
      logger.warn(
        { url, error: err instanceof Error ? err.message : String(err) },
        "Failed to scan page",
      );
    }
  }

  return {
    domain: ourDomain,
    sitePages: targets,
    externalLinksOut: externalLinks,
    internalLinkCount: internalCount,
    externalLinkCount: externalCount,
    scannedAt: new Date().toISOString(),
  };
}
