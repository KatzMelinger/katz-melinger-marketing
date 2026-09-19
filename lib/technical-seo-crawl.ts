/**
 * Real, live crawl-based technical SEO checks — replaces the hardcoded
 * schemaChecks/crawlErrors placeholders that used to live in
 * getTechnicalSeoMonitoring (lib/seo-intelligence.ts). Runs on-demand from the
 * "Re-scan" button on /seo/technical, which already tolerates a slow manual
 * run (PageSpeed alone is 60-120s), so a capped multi-page sample fits the
 * same budget.
 */

import { safeFetchTrace } from "@/lib/url-safety";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { getTenantConfig } from "@/lib/tenant-config";
import type { TechnicalMetric } from "@/lib/seo-intelligence";

const USER_AGENT = "Mozilla/5.0 (compatible; MarketingDashboardTechnicalSEO/0.1)";
const MAX_HOPS = 5;
// Keeps a manual re-scan well inside the route's time budget alongside PageSpeed.
const SAMPLE_SIZE = 20;

export type CrawlError = { url: string; issue: string; severity: "warning" | "critical" };

function safeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

// Reserve part of the sample for blog posts — service/pillar/practice pages
// vastly outnumber them in site_pages, so a plain "non-blog first" cutoff
// squeezed every blog post out and made Article-schema always read 0/0.
const MIN_BLOG_SAMPLE = 5;

/** Non-blog pages first (service/pillar/practice/case-result) — those carry
 * the business-critical schema; a reserved slice of blog posts fills the rest,
 * so Article-schema coverage always has something to measure against. */
async function samplePages(homeUrl: string, tenantId: string): Promise<string[]> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("site_pages")
    .select("url, page_type")
    .eq("tenant_id", tenantId)
    .limit(1000);
  const rows = (data ?? []) as { url: string; page_type: string }[];
  const nonBlog = rows.filter((r) => r.page_type !== "blog_post").map((r) => r.url);
  const blog = rows.filter((r) => r.page_type === "blog_post").map((r) => r.url);
  const nonBlogBudget = Math.max(0, SAMPLE_SIZE - 1 - Math.min(MIN_BLOG_SAMPLE, blog.length));
  const urls = [homeUrl, ...nonBlog.slice(0, nonBlogBudget), ...blog];
  return Array.from(new Set(urls)).slice(0, SAMPLE_SIZE);
}

function extractJsonLdTypes(html: string): Set<string> {
  const types = new Set<string>();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.["@graph"])
          ? parsed["@graph"]
          : [parsed];
      for (const node of nodes) {
        const t = node?.["@type"];
        if (typeof t === "string") types.add(t);
        else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") types.add(x);
      }
    } catch {
      // Malformed JSON-LD on a live page — skip it, don't fail the whole scan.
    }
  }
  return types;
}

function hasCanonical(html: string): boolean {
  return /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);
}

function isBlogPath(url: string): boolean {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return /\/blog\//.test(p) || /\/\d{4}\/\d{2}\//.test(p);
  } catch {
    return false;
  }
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const toStatus = (score: number): "healthy" | "warning" | "critical" =>
  score >= 80 ? "healthy" : score >= 40 ? "warning" : "critical";

export async function runTechnicalCrawl(
  homeUrl: string,
): Promise<{ schemaChecks: TechnicalMetric[]; crawlErrors: CrawlError[] }> {
  const tenantId = await resolveTenantId();
  const { seoDomain } = await getTenantConfig(tenantId);
  // site_pages only ever holds the tenant's OWN site — a competitor-domain
  // call (getTechnicalSeoMonitoring for /seo/competitors) must not sample it.
  const isOwnDomain = (() => {
    try {
      return new URL(homeUrl).host.replace(/^www\./, "") === safeDomain(seoDomain);
    } catch {
      return false;
    }
  })();
  const urls = isOwnDomain ? await samplePages(homeUrl, tenantId) : [homeUrl];

  const crawlErrors: CrawlError[] = [];
  let canonicalChecked = 0;
  let canonicalOk = 0;
  let orgSchemaFound = false;
  let faqChecked = 0;
  let faqFound = 0;
  let articleChecked = 0;
  let articleFound = 0;

  await Promise.all(
    urls.map(async (url) => {
      let trace: Awaited<ReturnType<typeof safeFetchTrace>>;
      try {
        trace = await safeFetchTrace(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
          timeoutMs: 12_000,
          maxRedirects: MAX_HOPS,
        });
      } catch (e) {
        crawlErrors.push({
          url,
          issue: e instanceof Error ? e.message : "Fetch failed",
          severity: "critical",
        });
        return;
      }

      if (trace.hops > 1) {
        crawlErrors.push({
          url,
          issue: `Redirect chain found (${trace.hops} hops)`,
          severity: trace.hops >= 3 ? "critical" : "warning",
        });
      }
      if (trace.res.status === 404) {
        crawlErrors.push({ url, issue: "404 Not Found", severity: "critical" });
        return;
      }
      if (!trace.res.ok) return;

      const html = (await trace.res.text()).slice(0, 200_000);

      canonicalChecked++;
      if (hasCanonical(html)) canonicalOk++;
      else crawlErrors.push({ url, issue: "Missing canonical tag", severity: "warning" });

      const types = extractJsonLdTypes(html);
      if (url === homeUrl && (types.has("Organization") || types.has("LegalService"))) {
        orgSchemaFound = true;
      }

      if (isBlogPath(url)) {
        articleChecked++;
        if (types.has("Article") || types.has("BlogPosting")) articleFound++;
      } else {
        faqChecked++;
        if (types.has("FAQPage")) faqFound++;
      }
    }),
  );

  const schemaChecks: TechnicalMetric[] = [
    {
      name: "Organization schema",
      score: orgSchemaFound ? 100 : 0,
      status: orgSchemaFound ? "healthy" : "critical",
      detail: orgSchemaFound
        ? "Organization/LegalService schema detected on the homepage."
        : "No Organization or LegalService JSON-LD found on the homepage.",
    },
    {
      name: "Canonical tag coverage",
      score: pct(canonicalOk, canonicalChecked),
      status: toStatus(pct(canonicalOk, canonicalChecked)),
      detail: `${canonicalOk}/${canonicalChecked} sampled pages carry a canonical tag.`,
    },
    {
      name: "FAQ schema coverage",
      score: pct(faqFound, faqChecked),
      status: toStatus(pct(faqFound, faqChecked)),
      detail: `${faqFound}/${faqChecked} sampled non-blog pages carry FAQPage schema.`,
    },
    {
      name: "Article schema consistency",
      score: pct(articleFound, articleChecked),
      status: toStatus(pct(articleFound, articleChecked)),
      detail: `${articleFound}/${articleChecked} sampled blog posts carry Article/BlogPosting schema.`,
    },
  ];

  return { schemaChecks, crawlErrors };
}
