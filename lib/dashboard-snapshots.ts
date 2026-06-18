/**
 * Server-side data layer for the executive board on the home page.
 *
 * One fetcher per department returns a normalized snapshot: a strip of KPIs
 * (live where an API exists, `soon: true` placeholders otherwise) plus, for the
 * three expanded departments, the extra rows/tables their detail panel renders.
 *
 * Every fetch is wrapped so a missing/unconfigured integration degrades to
 * placeholders instead of throwing — mirroring the existing graceful-degradation
 * pattern the old home page used for its hub snapshots.
 *
 * Imported only by the server component `app/page.tsx` (uses `next/headers` via
 * getRequestOrigin, so it must never be pulled into a Client Component).
 */

import { countContentDuplicates } from "@/lib/content-dedup";
import { getRequestOrigin } from "@/lib/request-origin";
import { resolveTenantId } from "@/lib/tenant-context";

export type Kpi = {
  label: string;
  /** Display value, already formatted. "—" when unsourced. */
  value: string;
  /** Optional short hint under the value. */
  hint?: string;
  /** True → render dimmed with a "Soon" tag (no live data source yet). */
  soon?: boolean;
};

export type LabeledCount = { label: string; value: number };
export type Row2 = {
  left: string;
  right: string;
  /** When set, the row's label links here (e.g. an actionable issue). */
  href?: string;
  /** "alert" renders the right value in a warning tone (e.g. a live issue count). */
  tone?: "alert";
};

export type SeoContentSnapshot = {
  kpis: Kpi[];
  pipelineStages: LabeledCount[];
  topOpportunities: Row2[];
};
export type OnPageSnapshot = {
  kpis: Kpi[];
  topLandingPages: Row2[];
  issues: Row2[];
};
export type OffPageSnapshot = {
  kpis: Kpi[];
  topLinkSources: Row2[];
  linkOpportunities: Row2[];
};

/**
 * Fetch JSON with a hard timeout. The board aggregates many departments, some
 * of which call slow external integrations (Semrush, Metricool). A bounded
 * fetch means one slow integration degrades to a "Coming soon" placeholder
 * instead of stalling the entire board.
 */
async function getJson<T>(path: string, timeoutMs = 4000): Promise<T | null> {
  try {
    const base = await getRequestOrigin();
    const res = await fetch(`${base}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Count an API payload that may be a bare array or `{ items: [] }`. */
function countList(payload: unknown): number | null {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === "object") {
    const items = (payload as { items?: unknown }).items;
    if (Array.isArray(items)) return items.length;
  }
  return null;
}

const SOON: Pick<Kpi, "value" | "soon"> = { value: "—", soon: true };
const num = (n: number) => n.toLocaleString("en-US");

// ── 0. Executive (top-of-board funnel summary) ───────────────────────────────

export async function getExecutiveKpis(): Promise<Kpi[]> {
  const [summary, attribution] = await Promise.all([
    getJson<{ totalCalls?: number; firstTimeCalls?: number }>("/api/callrail/summary"),
    getJson<{ breakdown?: Array<{ total_settlement_value?: number; settlement_count?: number }> }>(
      "/api/cms/attribution",
    ),
  ]);
  const breakdown = attribution?.breakdown ?? [];
  const settlementValue = breakdown.reduce((s, b) => s + (b.total_settlement_value ?? 0), 0);
  const settlementCount = breakdown.reduce((s, b) => s + (b.settlement_count ?? 0), 0);
  const intakes = summary?.firstTimeCalls ?? null;
  return [
    { label: "Total Calls", value: summary?.totalCalls != null ? num(summary.totalCalls) : SOON.value, soon: summary?.totalCalls == null },
    { label: "New Intakes", value: intakes != null ? num(intakes) : SOON.value, soon: intakes == null, hint: "First-time callers" },
    { label: "Matters", value: breakdown.length ? num(settlementCount) : SOON.value, soon: !breakdown.length, hint: "Settlements" },
    { label: "Settlement Value", value: breakdown.length ? "$" + num(Math.round(settlementValue)) : SOON.value, soon: !breakdown.length },
    { label: "Marketing ROI", ...SOON },
  ];
}

// ── 1. SEO Content ──────────────────────────────────────────────────────────

type PipelinePayload = {
  stats?: { total?: number; byStatus?: Record<string, number> };
};
type KeywordsPayload = {
  tracked?: Array<{ keyword: string; position: number; estimatedTraffic?: number; volume?: number }>;
  missingTargets?: string[];
};

export async function getSeoContentSnapshot(): Promise<SeoContentSnapshot> {
  const [pipe, kw] = await Promise.all([
    getJson<PipelinePayload>("/api/content/pipeline"),
    getJson<KeywordsPayload>("/api/seo/keywords"),
  ]);

  const byStatus = pipe?.stats?.byStatus ?? {};
  const total = pipe?.stats?.total ?? 0;
  const inProduction =
    (byStatus.brief ?? 0) + (byStatus.draft ?? 0) + (byStatus.review ?? 0);
  const published = byStatus.published ?? 0;
  const ideas = byStatus.idea ?? 0;

  const pipelineStages: LabeledCount[] = [
    { label: "Research", value: ideas },
    { label: "Brief", value: byStatus.brief ?? 0 },
    { label: "Writing", value: byStatus.draft ?? 0 },
    { label: "Review", value: byStatus.review ?? 0 },
    { label: "Published", value: published },
  ];

  // Top content opportunities: tracked keywords with the most upside, or the
  // explicit missing-target list when present.
  const tracked = kw?.tracked ?? [];
  const topOpportunities: Row2[] = tracked
    .filter((t) => t.position > 10)
    .sort((a, b) => (b.volume ?? b.estimatedTraffic ?? 0) - (a.volume ?? a.estimatedTraffic ?? 0))
    .slice(0, 5)
    .map((t) => ({ left: t.keyword, right: num(t.volume ?? t.estimatedTraffic ?? 0) }));

  const kpis: Kpi[] = [
    { label: "Opportunities", value: tracked.length ? num(tracked.filter((t) => t.position > 10).length) : SOON.value, soon: !tracked.length },
    { label: "In Production", value: pipe ? num(inProduction) : SOON.value, soon: !pipe },
    { label: "Published", value: pipe ? num(published) : SOON.value, soon: !pipe },
    { label: "Pipeline Total", value: pipe ? num(total) : SOON.value, soon: !pipe },
    { label: "Content Score", ...SOON },
  ];

  return { kpis, pipelineStages, topOpportunities };
}

// ── 2. On-Page SEO ───────────────────────────────────────────────────────────

export async function getOnPageSnapshot(): Promise<OnPageSnapshot> {
  const kw = await getJson<KeywordsPayload>("/api/seo/keywords");
  const tracked = kw?.tracked ?? [];
  const ranked = tracked.filter((t) => t.position > 0);
  const top3 = ranked.filter((t) => t.position <= 3).length;
  const top10 = ranked.filter((t) => t.position <= 10).length;
  const visibility = tracked.length ? Math.round((top10 / tracked.length) * 100) : 0;

  const topLandingPages: Row2[] = ranked
    .sort((a, b) => a.position - b.position)
    .slice(0, 5)
    .map((t) => ({ left: t.keyword, right: `#${t.position}` }));

  const kpis: Kpi[] = [
    { label: "Total Keywords", value: tracked.length ? num(tracked.length) : SOON.value, soon: !tracked.length },
    { label: "Top 3 Rankings", value: tracked.length ? num(top3) : SOON.value, soon: !tracked.length },
    { label: "Top 10 Rankings", value: tracked.length ? num(top10) : SOON.value, soon: !tracked.length },
    { label: "Visibility Score", value: tracked.length ? `${visibility}%` : SOON.value, soon: !tracked.length },
  ];

  // "Issues to fix" — Technical/meta rows are still placeholders; the duplicate
  // row is live off the registry duplicate scan. Computed directly (this runs in
  // the authed server render, so we have the real tenant) rather than via the
  // cookie-less internal fetch getJson uses.
  let dupCount: number | null = null;
  try {
    const tenantId = await resolveTenantId();
    dupCount = (await countContentDuplicates(tenantId)).groups;
  } catch {
    dupCount = null;
  }
  const duplicateRow: Row2 =
    dupCount == null
      ? { left: "Duplicate content", right: "—" }
      : dupCount === 0
        ? { left: "Duplicate content", right: "None" }
        : {
            left: "Duplicate content",
            right: `${dupCount}`,
            href: "/content-production",
            tone: "alert",
          };

  const issues: Row2[] = [
    { left: "Technical issues", right: "—" },
    { left: "Missing meta tags", right: "—" },
    duplicateRow,
  ];

  return { kpis, topLandingPages, issues };
}

// ── 3. Off-Page SEO ──────────────────────────────────────────────────────────

type BacklinksPayload = {
  overview?: { authorityScore?: number; totalBacklinks?: number; referringDomains?: number };
  domains?: Array<{ domain: string; backlinks: number; authorityScore: number }>;
  newBacklinksLast30d?: number;
  lostBacklinksLast30d?: number;
  linkBuildingOpportunities?: Array<{ domain: string; authorityScore: number }>;
};

export async function getOffPageSnapshot(): Promise<OffPageSnapshot> {
  const bl = await getJson<BacklinksPayload>("/api/seo/backlinks");
  const ov = bl?.overview;
  const hasData = !!ov;

  const topLinkSources: Row2[] = (bl?.domains ?? [])
    .slice(0, 5)
    .map((d) => ({ left: d.domain, right: num(d.backlinks) }));
  const linkOpportunities: Row2[] = (bl?.linkBuildingOpportunities ?? [])
    .slice(0, 5)
    .map((d) => ({ left: d.domain, right: `AS ${d.authorityScore}` }));

  const kpis: Kpi[] = [
    { label: "Total Backlinks", value: ov?.totalBacklinks != null ? num(ov.totalBacklinks) : SOON.value, soon: !hasData },
    { label: "Referring Domains", value: ov?.referringDomains != null ? num(ov.referringDomains) : SOON.value, soon: !hasData },
    { label: "Domain Rating", value: ov?.authorityScore != null ? num(ov.authorityScore) : SOON.value, soon: !hasData },
    { label: "New Backlinks", value: bl?.newBacklinksLast30d != null ? num(bl.newBacklinksLast30d) : SOON.value, soon: !hasData },
    { label: "Lost Backlinks", value: bl?.lostBacklinksLast30d != null ? num(bl.lostBacklinksLast30d) : SOON.value, soon: !hasData },
  ];

  return { kpis, topLinkSources, linkOpportunities };
}

// ── 4-9. Collapsed departments (KPI strip only) ──────────────────────────────

export async function getAiVisibilityKpis(): Promise<Kpi[]> {
  const aeo = await getJson<{ score?: number; averageScore?: number }>("/api/aeo/dashboard");
  const score = aeo?.score ?? aeo?.averageScore ?? null;
  return [
    { label: "AI Visibility Score", value: score != null ? `${Math.round(score)}%` : SOON.value, soon: score == null },
    { label: "AI Mentions", ...SOON },
    { label: "AI Referrals", ...SOON },
    { label: "Avg Position in AI", ...SOON },
    { label: "Citation Rate", ...SOON },
  ];
}

type ReviewsPayload = { reviews?: Array<{ rating?: number }> } | Array<{ rating?: number }>;

export async function getLocalKpis(): Promise<Kpi[]> {
  const reviews = await getJson<ReviewsPayload>("/api/reviews");
  const list = Array.isArray(reviews) ? reviews : (reviews?.reviews ?? []);
  const rated = list.filter((r) => typeof r.rating === "number");
  const avg = rated.length
    ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length
    : null;
  return [
    { label: "Local Visibility", ...SOON },
    { label: "GBP Interactions", ...SOON },
    { label: "Reviews", value: avg != null ? avg.toFixed(1) : SOON.value, soon: avg == null, hint: rated.length ? `${rated.length} total` : undefined },
    { label: "Local Citations", ...SOON },
    { label: "Map Rank Avg", ...SOON },
  ];
}

export async function getCampaignsKpis(): Promise<Kpi[]> {
  const summary = await getJson<{ totalCalls?: number; firstTimeCalls?: number }>("/api/callrail/summary");
  const leads = summary?.firstTimeCalls ?? null;
  return [
    { label: "Total Leads", value: leads != null ? num(leads) : SOON.value, soon: leads == null, hint: "First-time callers" },
    { label: "Total Calls", value: summary?.totalCalls != null ? num(summary.totalCalls) : SOON.value, soon: summary?.totalCalls == null },
    { label: "Cost Per Lead", ...SOON },
    { label: "Conversion Rate", ...SOON },
    { label: "ROI", ...SOON },
  ];
}

export async function getSocialKpis(): Promise<Kpi[]> {
  const social = await getJson<{
    overview?: Array<{ followers?: number; engagementRate?: number; postsThisMonth?: number }>;
  }>("/api/social/metricool");
  const overview = social?.overview ?? [];
  const followers = overview.reduce((s, r) => s + (r.followers ?? 0), 0);
  const posts = overview.reduce((s, r) => s + (r.postsThisMonth ?? 0), 0);
  const eng = overview.length
    ? overview.reduce((s, r) => s + (r.engagementRate ?? 0), 0) / overview.length
    : null;
  const connected = overview.length > 0;
  return [
    { label: "Total Followers", value: connected ? num(followers) : SOON.value, soon: !connected },
    { label: "Engagement Rate", value: eng != null ? `${eng.toFixed(1)}%` : SOON.value, soon: eng == null },
    { label: "Total Posts", value: connected ? num(posts) : SOON.value, soon: !connected },
    { label: "Profile Visits", ...SOON },
    { label: "Mentions", ...SOON },
  ];
}

export async function getIntelligenceKpis(): Promise<Kpi[]> {
  const [recs, alerts] = await Promise.all([
    getJson<unknown>("/api/recommendations/items"),
    getJson<unknown>("/api/alerts"),
  ]);
  const recCount = countList(recs);
  const alertCount = countList(alerts);
  return [
    { label: "Recommendations", value: recCount != null ? num(recCount) : SOON.value, soon: recCount == null },
    { label: "Alerts", value: alertCount != null ? num(alertCount) : SOON.value, soon: alertCount == null },
    { label: "Opportunities", ...SOON },
    { label: "Monthly Saved", ...SOON },
    { label: "ROI", ...SOON },
  ];
}

export async function getWorkspaceKpis(): Promise<Kpi[]> {
  const practice = await getJson<unknown>("/api/practice-areas");
  const practiceCount = countList(practice);
  return [
    { label: "Practice Areas", value: practiceCount != null ? num(practiceCount) : SOON.value, soon: practiceCount == null },
    { label: "Brand Voice", value: "Active", hint: "Configured" },
    { label: "Sales Coach", value: "Active", hint: "Configured" },
  ];
}
