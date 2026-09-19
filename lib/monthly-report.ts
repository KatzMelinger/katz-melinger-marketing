/**
 * Monthly SEO + Marketing report assembly — spec 4.3 (F1).
 *
 * Pulls together data that already exists in separate places (the keyword
 * tracker, backlinks, technical SEO, the rank-history snapshots from 4.1) into
 * the shape app/reports/page.tsx renders. GA4, AEO, and AI-bot-crawl data are
 * NOT assembled here — the report page fetches those from their own existing
 * endpoints (/api/analytics/*, /api/aeo/dashboard, /api/ai-bots/recent)
 * directly, the same way every other page in this app composes multiple data
 * sources, rather than this module re-implementing three unrelated API
 * integrations it doesn't own.
 *
 * lib/seo-intelligence.ts's getTechnicalSeoMonitoring() now also runs a real
 * live crawl for schemaChecks/crawlErrors (spec 4.2, lib/technical-seo-crawl.ts).
 * This module still only pulls the PageSpeed mobile/desktop scores out of it —
 * the crawl findings belong on /seo/technical (where a reviewer can act on
 * each one), not flattened into a monthly summary tile.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";
import { getTenantConfig } from "./tenant-config";
import {
  getBacklinkDomains,
  getBacklinkOverview,
  getTechnicalSeoMonitoring,
  getTrackedKeywordPerformance,
} from "./seo-intelligence";
import { ALL_KM_PILLARS } from "./km-content-system";
import { inferPillar, inferPracticeArea } from "./strategy-engine";

export type KpiWithTrend = {
  label: string;
  current: number;
  /** null when there's no prior-month snapshot yet to compare against. */
  prior: number | null;
};

export type PositionBand = { band: string; count: number };
export type ClusterKeywords = { pillar: string; label: string; keywords: string[] };

export type SeoReportData = {
  domain: string;
  kpis: {
    top10Count: KpiWithTrend;
    totalTracked: KpiWithTrend;
    estOrganicTraffic: KpiWithTrend;
    estTrafficValue: KpiWithTrend;
  };
  /** Distinct months present in seo_rank_snapshots, for the trend chart —
   *  oldest first. Short (even length 1) until the tracker has run for a
   *  while; the page must render that honestly, not pad it. */
  monthlyTrend: Array<{ month: string; top10Count: number; estOrganicTraffic: number }>;
  positionBands: PositionBand[];
  topKeywordsByCluster: ClusterKeywords[];
  backlinks: {
    authorityScore: number;
    totalBacklinks: number;
    referringDomains: number;
    /** Referring domains by toxicity risk (lib/seo-intelligence.ts's own
     *  low/medium/high bucketing of DataForSEO's backlinks_spam_score) — the
     *  closest thing to a "domain strength" spam signal this app already
     *  computes; there's no single aggregate spam score to average. */
    domainsByToxicity: { low: number; medium: number; high: number };
  };
  technical: {
    mobilePerformance: number;
    desktopPerformance: number;
    /** Schema/crawl-error checks now run a real live crawl (spec 4.2,
     *  lib/technical-seo-crawl.ts). Findings live on /seo/technical, where a
     *  reviewer can act on each one — this summary just points there. */
    schemaAndCrawlChecksConnected: true;
  };
  gaps: Array<{ keyword: string; searchVolume: number; reason: string }>;
};

const CTR_TOP10: Record<number, number> = {
  1: 0.317, 2: 0.247, 3: 0.187, 4: 0.13, 5: 0.095,
  6: 0.068, 7: 0.05, 8: 0.04, 9: 0.034, 10: 0.03,
};
function estClicks(position: number, volume: number): number {
  if (position < 1 || position > 100 || !volume) return 0;
  const ctr = position <= 10 ? CTR_TOP10[position] : position <= 20 ? 0.015 : position <= 50 ? 0.008 : 0.003;
  return Math.round(volume * ctr);
}

function positionBand(position: number): string {
  if (position <= 0) return "Not ranking";
  if (position <= 3) return "1-3";
  if (position <= 10) return "4-10";
  if (position <= 20) return "11-20";
  if (position <= 50) return "21-50";
  return "51-100";
}

/** Distinct (own-domain) snapshot months, oldest first, each with the KPI
 *  values as of that month's most recent snapshot. Reads seo_rank_snapshots
 *  (4.1) — returns [] gracefully if the table is empty or unreachable rather
 *  than throwing, since a fresh tenant may have no history yet. */
async function monthlyTrendFrom(
  tenantId: string,
  ownDomain: string,
): Promise<SeoReportData["monthlyTrend"]> {
  try {
    const sb = getSupabaseAdmin();

    // Two steps on purpose: a tenant tracking ~200 keywords across several
    // months easily has 10k+ snapshot rows. `.limit()` alone doesn't help —
    // this project's PostgREST caps every response at 1000 rows regardless
    // of the requested limit (confirmed against production: a 20000-row
    // request for ~15k matching rows still came back as exactly 1000, with
    // content-range reporting the true total). A single un-paginated query
    // silently returned only the OLDEST 1000 rows — a real bug caught by
    // testing this against production data, where the September rows never
    // appeared, only June's. So: paginate `captured_on` alone (cheap, and
    // duplicates collapse into the same handful of distinct dates regardless
    // of how many pages it takes), then fetch each target date's full rows
    // SEPARATELY — one date's rows (~200) comfortably fits in a single page.
    const seenDates = new Set<string>();
    for (let page = 0; page < 30; page++) {
      const { data: pageRows, error: pageErr } = await sb
        .from("seo_rank_snapshots")
        .select("captured_on")
        .eq("tenant_id", tenantId)
        .eq("domain", ownDomain)
        .range(page * 1000, page * 1000 + 999);
      if (pageErr || !pageRows?.length) break;
      for (const r of pageRows as Array<{ captured_on: string }>) seenDates.add(r.captured_on);
      if (pageRows.length < 1000) break; // last page
    }
    if (seenDates.size === 0) return [];

    // Latest captured_on per calendar month — the freshest read of that
    // month, not an average across it.
    const latestByMonth = new Map<string, string>();
    for (const captured_on of seenDates) {
      const month = captured_on.slice(0, 7);
      const cur = latestByMonth.get(month);
      if (!cur || captured_on > cur) latestByMonth.set(month, captured_on);
    }
    const months = [...latestByMonth.entries()].sort(([a], [b]) => a.localeCompare(b));

    const perDate = await Promise.all(
      months.map(async ([, date]) => {
        const { data } = await sb
          .from("seo_rank_snapshots")
          .select("rank")
          .eq("tenant_id", tenantId)
          .eq("domain", ownDomain)
          .eq("captured_on", date);
        return { date, rows: (data ?? []) as Array<{ rank: number | null }> };
      }),
    );
    const rowsByDate = new Map(perDate.map((p) => [p.date, p.rows]));

    return months.map(([month, date]) => {
      const rows = rowsByDate.get(date) ?? [];
      return {
        month,
        top10Count: rows.filter((r) => (r.rank ?? 0) > 0 && (r.rank ?? 999) <= 10).length,
        // Volume isn't stored on the snapshot row (it's a rank-only time
        // series — see supabase/seo_rank_snapshots_schema.sql), so the
        // trend's traffic figure is a ranked-keyword count proxy, not a
        // dollar estimate. The KPI tile itself uses the richer, volume-aware
        // live figure instead.
        estOrganicTraffic: rows.filter((r) => (r.rank ?? 0) > 0).length,
      };
    });
  } catch {
    return [];
  }
}

export async function getSeoReportData(tenantId?: string): Promise<SeoReportData> {
  const tid = tenantId ?? (await resolveTenantId());
  const { seoDomain } = await getTenantConfig(tid);

  const [tracked, backlinkOverview, backlinkDomains, technical, trend] = await Promise.all([
    getTrackedKeywordPerformance(seoDomain, tid),
    getBacklinkOverview(seoDomain).catch(() => ({ authorityScore: 0, totalBacklinks: 0, referringDomains: 0, followRatio: 0 })),
    getBacklinkDomains(seoDomain).catch(() => []),
    getTechnicalSeoMonitoring(`https://${seoDomain}`).catch(() => null),
    monthlyTrendFrom(tid, seoDomain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "")),
  ]);

  const rows = tracked.tracked;
  const top10 = rows.filter((r) => r.position > 0 && r.position <= 10);
  const estTraffic = rows.reduce((sum, r) => sum + estClicks(r.position, r.searchVolume), 0);
  const estValue = rows.reduce((sum, r) => sum + estClicks(r.position, r.searchVolume) * (r.cpc || 0), 0);

  // Prior month = the second-most-recent month bucket in the trend series, if
  // one exists yet. Until the tracker has run across a month boundary, this
  // is honestly null rather than a guessed delta.
  const priorBucket = trend.length >= 2 ? trend[trend.length - 2] : null;

  const bandCounts = new Map<string, number>();
  for (const r of rows) {
    const band = positionBand(r.position);
    bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
  }
  const positionBands: PositionBand[] = ["1-3", "4-10", "11-20", "21-50", "51-100", "Not ranking"]
    .map((band) => ({ band, count: bandCounts.get(band) ?? 0 }))
    .filter((b) => b.count > 0);

  // Top keywords by cluster (pillar) — deterministic, reuses the same
  // pillar-inference the content pipeline uses elsewhere, so "cluster" here
  // means the same thing it does on the rest of the site, not a new taxonomy.
  const byPillar = new Map<string, string[]>();
  for (const r of [...rows].filter((r) => r.position > 0).sort((a, b) => a.position - b.position).slice(0, 60)) {
    const input = { clusterName: r.keyword, primaryKeyword: r.keyword };
    const area = inferPracticeArea(input);
    const pillarId = inferPillar(input, area, ALL_KM_PILLARS) || `${area}-uncategorized`;
    const list = byPillar.get(pillarId) ?? [];
    if (list.length < 8) list.push(r.keyword);
    byPillar.set(pillarId, list);
  }
  const pillarLabel = new Map(ALL_KM_PILLARS.map((p) => [p.id, p.label]));
  const topKeywordsByCluster: ClusterKeywords[] = [...byPillar.entries()]
    .map(([pillar, keywords]) => ({
      pillar,
      label: pillarLabel.get(pillar) ?? pillar.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      keywords,
    }))
    .sort((a, b) => b.keywords.length - a.keywords.length)
    .slice(0, 8);

  const domainsByToxicity = {
    low: backlinkDomains.filter((d) => d.toxicityRisk === "low").length,
    medium: backlinkDomains.filter((d) => d.toxicityRisk === "medium").length,
    high: backlinkDomains.filter((d) => d.toxicityRisk === "high").length,
  };

  // Gaps/opportunities: target keywords the firm isn't ranking for at all —
  // the exact list getTrackedKeywordPerformance already computes for this
  // purpose (missingTargets), enriched with volume so it's a real worklist,
  // not just names.
  const volumeByKeyword = new Map(rows.map((r) => [r.keyword.toLowerCase(), r.searchVolume]));
  const gaps = tracked.missingTargets.slice(0, 15).map((keyword) => ({
    keyword,
    searchVolume: volumeByKeyword.get(keyword.toLowerCase()) ?? 0,
    reason: "Tracked target keyword with no ranking page in the top 100.",
  }));

  return {
    domain: seoDomain,
    kpis: {
      top10Count: { label: "Keywords in top 10", current: top10.length, prior: priorBucket?.top10Count ?? null },
      totalTracked: { label: "Total ranking keywords", current: rows.filter((r) => r.position > 0).length, prior: null },
      estOrganicTraffic: { label: "Est. organic visits/mo", current: estTraffic, prior: null },
      estTrafficValue: { label: "Est. traffic value/mo", current: Math.round(estValue), prior: null },
    },
    monthlyTrend: trend,
    positionBands,
    topKeywordsByCluster,
    backlinks: {
      authorityScore: backlinkOverview.authorityScore,
      totalBacklinks: backlinkOverview.totalBacklinks,
      referringDomains: backlinkOverview.referringDomains,
      domainsByToxicity,
    },
    technical: {
      mobilePerformance: technical?.mobile?.[0]?.score ?? 0,
      desktopPerformance: technical?.desktop?.[0]?.score ?? 0,
      schemaAndCrawlChecksConnected: true,
    },
    gaps,
  };
}

export type PipelineCounts = {
  inProduction: number;
  awaitingApproval: number;
  published: number;
  heldForLegal: number;
};

/** Content pipeline stage counts for the Marketing Status Report — a direct
 *  count query against content_drafts.status, not a re-derivation of the
 *  Production Board's own bucket logic (that page's grouping is UI-specific;
 *  this just needs the four numbers spec 4.3 asks for). */
export async function getPipelineCounts(tenantId?: string): Promise<PipelineCounts> {
  const tid = tenantId ?? (await resolveTenantId());
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("content_drafts")
      .select("status")
      .eq("tenant_id", tid);
    if (error || !data) return { inProduction: 0, awaitingApproval: 0, published: 0, heldForLegal: 0 };
    const rows = data as Array<{ status: string | null }>;
    const count = (statuses: string[]) => rows.filter((r) => r.status && statuses.includes(r.status)).length;
    return {
      inProduction: count(["idea", "brief", "draft"]),
      awaitingApproval: count(["review", "initial_review"]),
      published: count(["published"]),
      heldForLegal: count(["needs_legal"]),
    };
  } catch {
    return { inProduction: 0, awaitingApproval: 0, published: 0, heldForLegal: 0 };
  }
}
